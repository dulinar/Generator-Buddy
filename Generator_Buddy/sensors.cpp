#include "sensors.h"
#include "config.h"
#include <Wire.h>
#include <RTClib.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <time.h>

static RTC_DS3231 rtc;
static bool rtcFound = false;
static bool rtcSyncedWithNtp = false;
static DateTime compileTime;
static unsigned long bootMillis = 0;

static OneWire oneWire(PIN_DS18B20);
static DallasTemperature tempSensor(&oneWire);

static float voltageFactor = VOLTAGE_CAL_FACTOR;
static float fuelCalFactor = 1.0f;
static float idleCurrentRMS = 0.0f;
static unsigned long totalRuntimeSeconds = 0UL;
static unsigned long lastRuntimeCheck = 0;

// Measure single distance ping in cm (temperature-compensated speed of sound)
static float pingDistanceCm(float tempC) {
  float ambientT = (tempC > 0.0f) ? tempC : 28.0f; // Default 28C for Sri Lanka ambient if temp sensor disconnected
  float speedCmPerUs = (331.3f + (0.606f * ambientT)) / 10000.0f;

  digitalWrite(PIN_JSN_TRIG, LOW);
  delayMicroseconds(4);
  digitalWrite(PIN_JSN_TRIG, HIGH);
  delayMicroseconds(20);
  digitalWrite(PIN_JSN_TRIG, LOW);

  unsigned long duration = pulseIn(PIN_JSN_ECHO, HIGH, 40000);
  if (duration == 0) return -1.0f;

  return (duration * speedCmPerUs) / 2.0f;
}

// Read filtered median distance (5 samples for outlier rejection)
static float readMedianDistance(float tempC) {
  float samples[5];
  int count = 0;

  for (int i = 0; i < 5; i++) {
    float d = pingDistanceCm(tempC);
    if (d >= TANK_MIN_DIST_CM && d <= 450.0f) {
      samples[count++] = d;
    } else if (i == 1 && count == 0) {
      return -1.0f; // Fast exit if sensor is disconnected
    }
    delay(50);
  }

  // Require at least 3 valid echoes to reject random noise
  if (count < 3) return -1.0f;

  for (int i = 1; i < count; i++) {
    float key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  return samples[count / 2];
}

// Convert distance (cm) to fuel percentage (0.00 - 100.00)
static float distanceToFuelPct(float distCm) {
  float pct = ((TANK_HEIGHT_CM - distCm) / (TANK_HEIGHT_CM - TANK_MIN_DIST_CM)) * 100.0f;
  if (pct < 0.0f) pct = 0.0f;
  if (pct > 100.0f) pct = 100.0f;
  return pct;
}

// Measure AC RMS voltage from analog pin (returns 0 if sensor is disconnected/floating)
static float measureAnalogRMS(int pin) {
  const int samples = 1000;
  double sum = 0, sumSq = 0;

  for (int i = 0; i < samples; i++) {
    int adc = analogRead(pin);
    float v = (adc * 3.3f) / 4095.0f;
    sum += v;
    sumSq += v * v;
    delayMicroseconds(200);
  }

  float mean = sum / samples;

  // ZMPT101B and ACS712 have a steady DC midpoint bias (~1.5V - 2.6V).
  // If pin is unconnected/floating, mean falls outside [1.2V, 2.7V].
  if (mean < 1.2f || mean > 2.7f) {
    return 0.0f;
  }

  float variance = (sumSq / samples) - (mean * mean);
  return (variance > 0.0f) ? sqrt(variance) : 0.0f;
}

// -------------------------------------------------------------
// Initialize and Auto-Calibrate All Sensors (Bluetooth Debug)
// -------------------------------------------------------------
bool initSensors() {
  SerialBT.println("\n--- Sensor Initialization & Calibration ---");

  compileTime = DateTime(F(__DATE__), F(__TIME__));
  bootMillis = millis();

  // 1. RTC DS3231
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (rtc.begin(&Wire)) {
    rtcFound = true;
    DateTime now = rtc.now();
    if (rtc.lostPower() || now.unixtime() < compileTime.unixtime()) {
      rtc.adjust(compileTime);
      now = rtc.now();
    }
    SerialBT.printf("[RTC] OK - Current Time: %04d-%02d-%02d %02d:%02d:%02d\n",
                    now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second());
  } else {
    rtcFound = false;
    SerialBT.println("[RTC] Not connected on I2C (will use Sri Lanka NTP / system time).");
  }

  // 2. DS18B20 Temperature Sensor (GPIO 4)
  tempSensor.begin();
  float initTemp = 0.0f;
  if (tempSensor.getDeviceCount() > 0) {
    tempSensor.requestTemperatures();
    float t = tempSensor.getTempCByIndex(0);
    if (t != DEVICE_DISCONNECTED_C && t > -50.0f && t < 125.0f) {
      initTemp = t;
      SerialBT.printf("[DS18B20] OK - Temperature: %.1f C (GPIO %d)\n", initTemp, PIN_DS18B20);
    } else {
      SerialBT.printf("[DS18B20] Connected but invalid reading on GPIO %d -> 0.0 C\n", PIN_DS18B20);
    }
  } else {
    SerialBT.printf("[DS18B20] Not connected on GPIO %d -> 0.0 C\n", PIN_DS18B20);
  }

  // 3. JSN-SR04T Fuel Sensor Calibration (GPIO 5 / 18)
  pinMode(PIN_JSN_TRIG, OUTPUT);
  pinMode(PIN_JSN_ECHO, INPUT_PULLDOWN);
  digitalWrite(PIN_JSN_TRIG, LOW);
  SerialBT.println("[JSN-SR04T] Starting Ultrasonic Calibration...");

  float distSum = 0;
  int validPasses = 0;
  for (int r = 1; r <= 3; r++) {
    float d = readMedianDistance(initTemp);
    if (d > 0) {
      distSum += d;
      validPasses++;
      SerialBT.printf("  Pass %d/3: %.2f cm\n", r, d);
    } else {
      SerialBT.printf("  Pass %d/3: Sensor not connected or no echo\n", r);
    }
  }

  if (validPasses > 0) {
    float avgDist = distSum / validPasses;
    float initFuel = distanceToFuelPct(avgDist * fuelCalFactor);
    SerialBT.printf("[JSN-SR04T] Calibrated OK - Avg Dist: %.2f cm | Initial Fuel: %.2f\n",
                    avgDist, initFuel);
  } else {
    SerialBT.println("[JSN-SR04T] Not connected -> Initial Fuel: 0.00");
  }

  // 4. ZMPT101B AC Voltage Auto-Calibration (GPIO 35)
  analogReadResolution(12);
  analogSetPinAttenuation(PIN_ZMPT101B, ADC_11db);
  analogSetPinAttenuation(PIN_ACS712, ADC_11db);

  float sensorRMS = measureAnalogRMS(PIN_ZMPT101B);
  SerialBT.printf("[ZMPT101B] Sensor RMS = %.4f V\n", sensorRMS);
  if (sensorRMS >= 0.20f && sensorRMS <= 0.85f) {
    voltageFactor = REFERENCE_VOLTAGE / sensorRMS;
    SerialBT.printf("[ZMPT101B] Auto-Calibrated: Factor = %.2f (Ref %.1fV)\n",
                    voltageFactor, REFERENCE_VOLTAGE);
  } else {
    voltageFactor = VOLTAGE_CAL_FACTOR;
    SerialBT.printf("[ZMPT101B] No AC voltage or sensor disconnected. Factor = %.2f\n", voltageFactor);
  }

  // 5. ACS712 Current Sensor Baseline (GPIO 34)
  idleCurrentRMS = measureAnalogRMS(PIN_ACS712);
  SerialBT.printf("[ACS712] Baseline RMS on GPIO %d: %.4f V\n", PIN_ACS712, idleCurrentRMS);

  SerialBT.println("--- Sensor Initialization & Calibration Complete ---\n");
  lastRuntimeCheck = millis() / 1000;
  return rtcFound;
}

// -------------------------------------------------------------
// Read All Sensors
// -------------------------------------------------------------
void readSensors(GeneratorData &data) {
  // 1. Timestamp (Sri Lanka Time UTC+5:30 via NTP, RTC, or Compile Time)
  struct tm timeinfo;
  if (getLocalTime(&timeinfo, 10) && timeinfo.tm_year > 120) {
    snprintf(data.recorded_at, sizeof(data.recorded_at),
             "%04d-%02d-%02dT%02d:%02d:%02d",
             timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
             timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    if (rtcFound && !rtcSyncedWithNtp) {
      rtc.adjust(DateTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                          timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec));
      rtcSyncedWithNtp = true;
    }
  } else if (rtcFound) {
    DateTime now = rtc.now();
    snprintf(data.recorded_at, sizeof(data.recorded_at),
             "%04d-%02d-%02dT%02d:%02d:%02d",
             now.year(), now.month(), now.day(),
             now.hour(), now.minute(), now.second());
  } else {
    DateTime now = compileTime + TimeSpan((millis() - bootMillis) / 1000);
    snprintf(data.recorded_at, sizeof(data.recorded_at),
             "%04d-%02d-%02dT%02d:%02d:%02d",
             now.year(), now.month(), now.day(),
             now.hour(), now.minute(), now.second());
  }

  // 2. Temperature from DS18B20 (GPIO 4) - 0.0 if disconnected
  if (tempSensor.getDeviceCount() > 0) {
    tempSensor.requestTemperatures();
    float t = tempSensor.getTempCByIndex(0);
    data.temperature = (t != DEVICE_DISCONNECTED_C && t > -50.0f && t < 125.0f) ? t : 0.0f;
  } else {
    data.temperature = 0.0f;
  }

  // 3. Fuel Level Percentage (0.00 - 100.00) - 0.00 if disconnected
  float dist = readMedianDistance(data.temperature);
  data.fuel_level = (dist > 0) ? distanceToFuelPct(dist * fuelCalFactor) : 0.00f;

  // 4. AC Voltage from ZMPT101B (GPIO 35) - 0.0 if disconnected or < 50V
  float vRMS = measureAnalogRMS(PIN_ZMPT101B);
  float v = (vRMS >= 0.15f) ? (vRMS * voltageFactor) : 0.0f;
  data.voltage = (v < 50.0f) ? 0.0f : v;

  // 5. Generator Status & Frequency (running if AC voltage is present, else offline)
  bool acPresent = (data.voltage >= 100.0f);
  strncpy(data.status, acPresent ? "running" : "offline", sizeof(data.status));
  data.frequency = acPresent ? 50.0f : 0.0f;

  // 6. Output Current from ACS712 (GPIO 34) - 0.0 if disconnected or offline
  if (acPresent) {
    float cRMS = measureAnalogRMS(PIN_ACS712) - idleCurrentRMS;
    float c = (cRMS > 0.02f) ? (cRMS / CURRENT_SENSITIVITY) : 0.0f;
    data.current = (c < 0.25f) ? 0.0f : c;
  } else {
    data.current = 0.0f;
  }

  // 7. Runtime Tracking (starts at 0, accumulates seconds only while running)
  unsigned long nowSec = millis() / 1000;
  if (acPresent && lastRuntimeCheck > 0) {
    totalRuntimeSeconds += (nowSec - lastRuntimeCheck);
  }
  lastRuntimeCheck = nowSec;
  data.runtime_seconds = totalRuntimeSeconds;

  // Bluetooth debug log
  SerialBT.printf("[SENSORS] Time: %s | Status: %s | Volt: %.1fV | Curr: %.2fA | Freq: %.1fHz | Temp: %.1fC | Fuel: %.2f | Runtime: %lus\n",
                  data.recorded_at, data.status, data.voltage, data.current, data.frequency,
                  data.temperature, data.fuel_level, (unsigned long)data.runtime_seconds);
}
