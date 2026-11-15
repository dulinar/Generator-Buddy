#include "sensors.h"
#include "config.h"
#include <Wire.h>
#include <RTClib.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Preferences.h>
#include <time.h>
#include "display.h"

// ======================== OPTIONAL TUNING (override in config.h if needed) ========================

// ACS712 -> ESP32 divider ratio (V_at_ADC / V_at_sensor).
//   1.0   = ACS712 output wired directly to the ADC pin
//   0.667 = 10k (top) + 20k (bottom) divider, etc.
// The effective sensitivity becomes CURRENT_SENSITIVITY * CURRENT_DIVIDER_RATIO.
#ifndef CURRENT_DIVIDER_RATIO
#define CURRENT_DIVIDER_RATIO 1.0f
#endif

// Typical AC-RMS noise of the ESP32 ADC with nothing connected (volts). Auto-tracked at runtime.
#ifndef CURRENT_NOISE_FLOOR_V
#define CURRENT_NOISE_FLOOR_V 0.006f
#endif

// Currents below this are reported as 0 (ACS712-30A is not accurate below ~0.3-0.5 A anyway)
#ifndef CURRENT_DEADBAND_A
#define CURRENT_DEADBAND_A 0.10f
#endif

// RMS window: 200 ms = exactly 10 cycles at 50 Hz (or 12 at 60 Hz) -> no partial-cycle error
#ifndef AC_WINDOW_US
#define AC_WINDOW_US 200000UL
#endif

// Frequency measurement windows
#ifndef FREQ_MEAN_WINDOW_US
#define FREQ_MEAN_WINDOW_US 100000UL   // 5 cycles @ 50 Hz, used to find the DC centre
#endif
#ifndef FREQ_EDGE_WINDOW_US
#define FREQ_EDGE_WINDOW_US 300000UL   // ~15 cycles @ 50 Hz, used to time rising edges
#endif

// Calibrated ADC readings above this (mV) are treated as clipped (11 dB range tops out near 3.1 V)
#define ADC_CLIP_MV 3050

// --- Static objects ---
static RTC_DS3231 rtc;
static bool rtcFound = false;
static DateTime compileTime;
static unsigned long bootMillis = 0;

static OneWire oneWire(PIN_DS18B20);
static DallasTemperature tempSensor(&oneWire);

static float voltageFactor = VOLTAGE_CAL_FACTOR;
static bool fuelValid = false;
static bool rtcTimeValid = false;
static bool previousRunning = false;
static uint64_t fallbackElapsedMs = 0;
static uint32_t fallbackLastMillis = 0;
static unsigned long totalRuntimeSeconds = 0UL;
static unsigned long lastRuntimeMillis = 0;
static unsigned long lastSaveMillis = 0;
static Preferences prefs;

static float currentNoiseFloorV = CURRENT_NOISE_FLOOR_V;  // learned while generator is stopped
static float lastGoodFreq = 0.0f;
static int freqFailCount = 0;
static float lastFuelPct = 0.0f;

// ======================== FUEL SENSOR ========================

// Single ultrasonic ping, returns distance in cm (-1 if no echo)
static float pingDistanceCm(float tempC) {
  float speed = (331.3f + 0.606f * ((tempC > 0) ? tempC : 28.0f)) / 10000.0f;

  digitalWrite(PIN_JSN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_JSN_TRIG, HIGH);
  delayMicroseconds(20);
  digitalWrite(PIN_JSN_TRIG, LOW);

  unsigned long us = pulseIn(PIN_JSN_ECHO, HIGH, 40000);
  return (us == 0) ? -1.0f : (us * speed) / 2.0f;
}

// Distance to fuel percentage (0-100)
static float distanceToFuelPct(float cm) {
  float pct = ((TANK_HEIGHT_CM - cm) / (TANK_HEIGHT_CM - TANK_MIN_DIST_CM)) * 100.0f;
  return constrain(pct, 0.0f, 100.0f);
}

// Median of FUEL_SAMPLE_COUNT readings (median rejects stray echoes better than a mean).
// If every ping fails, the last good value is kept instead of reporting 0 %.
static float readAverageFuelPct(float tempC) {
  float vals[FUEL_SAMPLE_COUNT];
  int valid = 0;
  fuelValid = false;

  for (int i = 0; i < FUEL_SAMPLE_COUNT; i++) {
    float d = pingDistanceCm(tempC);
    if (d >= TANK_MIN_DIST_CM && d <= 450.0f) {
      float p = distanceToFuelPct(d);
      // insertion sort
      int j = valid++;
      while (j > 0 && vals[j - 1] > p) {
        vals[j] = vals[j - 1];
        j--;
      }
      vals[j] = p;
    }
    delay(35);
  }

  if (valid == 0) return lastFuelPct;

  fuelValid = true;
  lastFuelPct = (valid % 2) ? vals[valid / 2]
                            : (vals[valid / 2 - 1] + vals[valid / 2]) / 2.0f;
  return lastFuelPct;
}

// ======================== ANALOG AC MEASUREMENT ========================

struct AcStats {
  float meanV;       // DC centre (V)
  float rmsV;        // AC-only RMS (V)
  uint16_t samples;
  uint16_t clipped;  // samples that hit the top of the ADC range
  bool valid;        // false if the pin looks disconnected
};

// Sample a pin for exactly AC_WINDOW_US (whole number of mains cycles) using calibrated mV readings.
static AcStats sampleAc(int pin) {
  AcStats s = {};
  double sum = 0.0, sumSq = 0.0;
  uint32_t n = 0, clipped = 0;

  uint32_t start = micros();
  while ((uint32_t)(micros() - start) < AC_WINDOW_US) {
    uint32_t mv = analogReadMilliVolts(pin);
    if (mv >= ADC_CLIP_MV) clipped++;
    double v = mv / 1000.0;
    sum += v;
    sumSq += v * v;
    n++;
    delayMicroseconds(50);
  }

  if (n < 100) return s;

  double mean = sum / n;
  double var = (sumSq / n) - (mean * mean);

  s.meanV = (float)mean;
  s.rmsV = (var > 0.0) ? (float)sqrt(var) : 0.0f;
  s.samples = (n > 65535) ? 65535 : (uint16_t)n;
  s.clipped = (clipped > 65535) ? 65535 : (uint16_t)clipped;
  s.valid = (mean >= 0.2 && mean <= 3.1);
  if (!s.valid) s.rmsV = 0.0f;  // Pin disconnected / floating
  return s;
}

// Measure AC frequency by timing RISING zero-crossings (interpolated between samples).
// freq = (edges - 1) / (time between first and last edge), so the resolution is ~0.03 Hz
// instead of the 2.5 Hz steps you get when counting crossings in a fixed 200 ms window.
// Returns 0 if no valid measurement.
static float measureFrequency(int pin) {
  // Pass 1: DC centre and amplitude over a fixed window (raw ADC counts)
  long adcSum = 0;
  int n = 0, mn = 4095, mx = 0;
  uint32_t start = micros();
  while ((uint32_t)(micros() - start) < FREQ_MEAN_WINDOW_US) {
    int a = analogRead(pin);
    adcSum += a;
    n++;
    if (a < mn) mn = a;
    if (a > mx) mx = a;
    delayMicroseconds(50);
  }
  if (n < 100) return 0.0f;

  float mean = (float)adcSum / n;
  float amp = (mx - mn) / 2.0f;

  if (mean < 200 || mean > 3900) return 0.0f;  // No signal / pin floating
  if (amp < 40.0f) return 0.0f;                // Signal too small (< ~32 mV peak)

  // Hysteresis scales with amplitude (25 %), never below 15 counts
  float hyst = amp * 0.25f;
  if (hyst < 15.0f) hyst = 15.0f;
  const float loThresh = mean - hyst;

  // Pass 2: find rising crossings of the mean line, re-armed only after the signal dips below loThresh
  int edges = 0;
  float firstEdge = 0.0f, lastEdge = 0.0f;

  uint32_t t0 = micros();
  int prevAdc = analogRead(pin);
  float prevT = 0.0f;
  bool armed = (prevAdc < loThresh);

  uint32_t nowUs;
  while ((nowUs = micros() - t0) < FREQ_EDGE_WINDOW_US) {
    int adc = analogRead(pin);
    nowUs = micros() - t0;
    float t = (float)nowUs;

    if (adc < loThresh) {
      armed = true;
    } else if (armed && prevAdc < mean && adc >= mean) {
      float frac = (mean - prevAdc) / (float)(adc - prevAdc);  // linear interpolation
      float tEdge = prevT + frac * (t - prevT);
      if (edges == 0) firstEdge = tEdge;
      lastEdge = tEdge;
      edges++;
      armed = false;
    }

    prevAdc = adc;
    prevT = t;
    delayMicroseconds(50);
  }

  if (edges < 5) return 0.0f;  // need at least 4 full periods

  float span = lastEdge - firstEdge;  // microseconds
  if (span <= 0.0f) return 0.0f;

  float freq = (edges - 1) * 1000000.0f / span;
  return (freq >= 40.0f && freq <= 65.0f) ? freq : 0.0f;
}

// ======================== RTC SYNC ========================

void syncRtcWithTime(int year, int month, int day, int hour, int minute, int second) {
  if (rtcFound && year >= 2026) {
    rtc.adjust(DateTime(year, month, day, hour, minute, second));
    rtcTimeValid = true;
    SerialBT.printf("[RTC] Synced: %04d-%02d-%02d %02d:%02d:%02d\n",
                    year, month, day, hour, minute, second);
  }
}

// ======================== INIT & CALIBRATION ========================

bool initSensors() {
  SerialBT.println("\n--- Sensor Init & Calibration ---");

  compileTime = DateTime(F(__DATE__), F(__TIME__));
  bootMillis = millis();
  fallbackLastMillis = bootMillis;

  // Load saved runtime from flash
  if (!prefs.begin("genbuddy", false)) SerialBT.println("[NVS] Runtime storage unavailable");
  totalRuntimeSeconds = prefs.getULong("runtime", 0UL);
  SerialBT.printf("[NVS] Loaded runtime: %lu s\n", totalRuntimeSeconds);

  // 1. RTC DS3231
  showDisplayStage("Checking sensors", "RTC clock...");
  if (rtc.begin(&Wire)) {
    rtcFound = true;
    DateTime now = rtc.now();
    if (rtc.lostPower() || now.year() < 2026) {
      // Do not clear the lost-power flag with guessed compile time: on the next
      // boot that would make an unsynchronized clock look trustworthy.
      rtcTimeValid = false;
      SerialBT.println("[RTC] Time invalid; waiting for synchronization");
    } else {
      rtcTimeValid = true;
      SerialBT.printf("[RTC] OK: %04d-%02d-%02d %02d:%02d:%02d\n",
                      now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second());
    }
  } else {
    rtcFound = false;
    SerialBT.println("[RTC] Not detected!");
  }

  showDisplayStage("Checking sensors", "Temperature...");
  // 2. DS18B20 Temperature
  pinMode(PIN_DS18B20, INPUT_PULLUP);
  tempSensor.begin();
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  bool tempOK = (t != DEVICE_DISCONNECTED_C && t >= -55 && t <= 125);
  SerialBT.printf("[DS18B20] %s: %.1f C\n", tempOK ? "OK" : "Not detected", tempOK ? t : 0.0f);

  showDisplayStage("Checking sensors", "Fuel level...");
  // 3. JSN-SR04T Fuel
  pinMode(PIN_JSN_TRIG, OUTPUT);
  pinMode(PIN_JSN_ECHO, INPUT_PULLDOWN);
  digitalWrite(PIN_JSN_TRIG, LOW);
  float fuel = readAverageFuelPct(28.0f);
  SerialBT.printf("[JSN-SR04T] Fuel: %.2f%%\n", fuel);

  showDisplayStage("Checking sensors", "Voltage / current...");
  // 4. ZMPT101B Voltage check
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_ZMPT101B, ADC_11db);
  analogSetPinAttenuation(PIN_ACS712, ADC_11db);

  AcStats v = sampleAc(PIN_ZMPT101B);
  SerialBT.printf("[ZMPT101B] Mean: %.3f V  RMS: %.4f V  clipped: %u\n", v.meanV, v.rmsV, v.clipped);
  if (v.clipped > 0) {
    SerialBT.println("[ZMPT101B] ADC clipping: check analog scaling and module calibration.");
  }
  // Startup voltage is not a known reference: preserve real under/overvoltage.
  voltageFactor = VOLTAGE_CAL_FACTOR;
  SerialBT.printf("[ZMPT101B] Configured factor: %.1f\n", voltageFactor);

  // 5. ACS712 Current sensor check
  AcStats c = sampleAc(PIN_ACS712);
  SerialBT.printf("[ACS712] Mean: %.3f V  RMS: %.4f V  clipped: %u\n", c.meanV, c.rmsV, c.clipped);
  SerialBT.printf("[ACS712] Expected zero-current mean: ~%.2f V (2.5 V x divider %.3f)\n",
                  2.5f * CURRENT_DIVIDER_RATIO, (float)CURRENT_DIVIDER_RATIO);

  // No AC voltage at boot => no current can be flowing => RMS reading is pure ADC noise
  bool acAtBoot = (v.rmsV * voltageFactor) > 30.0f;
  if (v.valid && v.clipped == 0 && !acAtBoot && c.valid && c.rmsV < 0.03f) {
    currentNoiseFloorV = c.rmsV;
    SerialBT.printf("[ACS712] Noise floor learned: %.4f V\n", currentNoiseFloorV);
  } else {
    SerialBT.printf("[ACS712] Noise floor default: %.4f V\n", currentNoiseFloorV);
  }

  SerialBT.println("--- Init Complete ---\n");
  lastRuntimeMillis = millis();
  return rtcFound;
}

// ======================== READ ALL SENSORS ========================

void readSensors(GeneratorData &data) {

  // 1. Timestamp (Sri Lanka time: NTP > RTC > compile fallback)
  uint32_t timestampMillis = millis();
  fallbackElapsedMs += (uint32_t)(timestampMillis - fallbackLastMillis);
  fallbackLastMillis = timestampMillis;
  data.time_valid = false;
  struct tm ti;
  if (getLocalTime(&ti, 10) && ti.tm_year > 120) {
    data.time_valid = true;
    snprintf(data.recorded_at, sizeof(data.recorded_at), "%04d-%02d-%02dT%02d:%02d:%02d",
             ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday, ti.tm_hour, ti.tm_min, ti.tm_sec);
  } else if (rtcFound && rtcTimeValid) {
    data.time_valid = rtcTimeValid;
    DateTime n = rtc.now();
    snprintf(data.recorded_at, sizeof(data.recorded_at), "%04d-%02d-%02dT%02d:%02d:%02d",
             n.year(), n.month(), n.day(), n.hour(), n.minute(), n.second());
  } else {
    DateTime n = compileTime + TimeSpan((int32_t)(fallbackElapsedMs / 1000));
    snprintf(data.recorded_at, sizeof(data.recorded_at), "%04d-%02d-%02dT%02d:%02d:%02d",
             n.year(), n.month(), n.day(), n.hour(), n.minute(), n.second());
  }

  // 2. Temperature
  tempSensor.requestTemperatures();
  float t = tempSensor.getTempCByIndex(0);
  data.temperature_valid = (t != DEVICE_DISCONNECTED_C && t >= -55 && t <= 125);
  data.temperature = data.temperature_valid ? t : 0.0f;

  // 3. Fuel level (median of several pings)
  // Engine temperature is not the tank air temperature.
  data.fuel_level = readAverageFuelPct(28.0f);
  data.fuel_valid = fuelValid;

  // 4. AC Voltage
  AcStats v = sampleAc(PIN_ZMPT101B);
  data.voltage_valid = v.valid && v.clipped == 0;
  data.voltage = (v.rmsV > 0.02f) ? (v.rmsV * voltageFactor) : 0.0f;
  if (data.voltage < 15.0f) data.voltage = 0.0f;

  // 5. Status (running if voltage > 30V)
  bool acPresent = data.voltage_valid && (data.voltage > 30.0f);
  strcpy(data.status, acPresent ? "running" : "stopped");

  // 6. Current — ALWAYS measured (not gated on generator status)
  AcStats c = sampleAc(PIN_ACS712);

  data.current_valid = c.valid && c.clipped == 0;

  // While the generator is stopped no current can flow, so the ADC noise floor can be tracked
  if (data.voltage_valid && !acPresent && c.valid && c.rmsV < 0.03f) {
    currentNoiseFloorV = 0.9f * currentNoiseFloorV + 0.1f * c.rmsV;
  }

  // Remove the noise floor in quadrature (noise and signal are uncorrelated)
  float netV = sqrtf(fmaxf(0.0f, c.rmsV * c.rmsV - currentNoiseFloorV * currentNoiseFloorV));
  float amps = netV / (CURRENT_SENSITIVITY * CURRENT_DIVIDER_RATIO);
  data.current = (amps < CURRENT_DEADBAND_A) ? 0.0f : amps;

  // 7. Frequency (rising-edge period timing; hold last good value through a brief glitch)
  if (acPresent) {
    float f = measureFrequency(PIN_ZMPT101B);
    data.frequency_valid = f > 0.0f;
    if (f > 0.0f) {
      lastGoodFreq = f;
      freqFailCount = 0;
    } else if (++freqFailCount >= 3) {
      lastGoodFreq = 0.0f;
    }
    data.frequency = lastGoodFreq;
  } else {
    lastGoodFreq = 0.0f;
    freqFailCount = 0;
    data.frequency = 0.0f;
    data.frequency_valid = data.voltage_valid;
  }

  if (!data.voltage_valid || !data.current_valid || !data.temperature_valid ||
      !data.fuel_valid || !data.frequency_valid) strcpy(data.status, "fault");

  // Debug: raw sensor values for voltage & current
  SerialBT.printf("[RAW] vMean=%.3f vRMS=%.4f vClip=%u | cMean=%.3f cRMS=%.4f noise=%.4f cClip=%u amps=%.2f\n",
                  v.meanV, v.rmsV, v.clipped, c.meanV, c.rmsV, currentNoiseFloorV, c.clipped, amps);
  if (v.clipped > 0) SerialBT.println("[WARN] ZMPT101B ADC clipping - voltage/frequency readings unreliable");
  if (c.clipped > 0) SerialBT.println("[WARN] ACS712 ADC clipping - current reads LOW; add a divider (see CURRENT_DIVIDER_RATIO)");

  // 8. Runtime tracking
  unsigned long now = millis();
  unsigned long elapsed = (now - lastRuntimeMillis) / 1000;
  if (elapsed > 0) {
#if RUNTIME_COUNT_ALWAYS
    totalRuntimeSeconds += elapsed;
#else
    if (previousRunning && acPresent) totalRuntimeSeconds += elapsed;
#endif
    lastRuntimeMillis += elapsed * 1000;
  }
  previousRunning = acPresent;
  data.runtime_seconds = totalRuntimeSeconds;

  // Save runtime to flash periodically
  if (now - lastSaveMillis >= (unsigned long)RUNTIME_SAVE_INTERVAL_S * 1000UL) {
    if (prefs.putULong("runtime", totalRuntimeSeconds) != sizeof(totalRuntimeSeconds))
      SerialBT.println("[NVS] Runtime save failed");
    lastSaveMillis = now;
    SerialBT.printf("[NVS] Saved: %lu s\n", totalRuntimeSeconds);
  }

  // Summary debug log
  SerialBT.printf("[DATA] %s | %s | V:%.1f | A:%.2f | Hz:%.2f | T:%.1f | F:%.2f | R:%lus\n",
                  data.recorded_at, data.status, data.voltage, data.current,
                  data.frequency, data.temperature, data.fuel_level,
                  (unsigned long)data.runtime_seconds);
}

bool formatTelemetry(const GeneratorData &d, char *buffer, size_t capacity) {
  // Keep the existing numeric schema; status=fault and validity flags identify
  // unavailable readings. Consumers should honor these flags, never infer health from zero.
  int n = snprintf(buffer, capacity,
    "{\"recorded_at\":\"%s\",\"status\":\"%s\",\"voltage\":%.1f,\"current\":%.1f,"
    "\"frequency\":%.1f,\"temperature\":%.1f,\"fuel_level\":%.1f,\"runtime_seconds\":%lu,"
    "\"voltage_valid\":%s,\"current_valid\":%s,\"frequency_valid\":%s,"
    "\"temperature_valid\":%s,\"fuel_valid\":%s,\"time_valid\":%s}",
    d.recorded_at, d.status,
    isfinite(d.voltage) ? d.voltage : 0.0f, isfinite(d.current) ? d.current : 0.0f,
    isfinite(d.frequency) ? d.frequency : 0.0f, isfinite(d.temperature) ? d.temperature : 0.0f,
    isfinite(d.fuel_level) ? d.fuel_level : 0.0f, (unsigned long)d.runtime_seconds,
    d.voltage_valid ? "true" : "false", d.current_valid ? "true" : "false",
    d.frequency_valid ? "true" : "false", d.temperature_valid ? "true" : "false",
    d.fuel_valid ? "true" : "false", d.time_valid ? "true" : "false");
  return n >= 0 && (size_t)n < capacity;
}
