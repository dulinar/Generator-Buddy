/*
 * JSN-SR04T V3.0 / V3.3 Ultrasonic Distance Sensor
 * Optimized for High Accuracy, Liquid / Fuel Tanks, and Outlier Rejection
 *
 * Microcontroller: ESP32 (or Arduino with pin adjustments)
 * Hardware connections:
 *   - VCC  -> 5V (Stable 5V power supply)
 *   - GND  -> GND (Common ground)
 *   - TRIG -> GPIO 5
 *   - ECHO -> GPIO 18 (Use a voltage divider: 1k / 2k resistor to drop 5V to 3.3V)
 */

#define TRIG_PIN 5
#define ECHO_PIN 18

// ========================================================
// SENSOR PHYSICAL LIMITS
// ========================================================
// IMPORTANT: JSN-SR04T has a blind zone of 20 - 25 cm.
// Any target closer than 22 cm will produce erratic readings!
const float MIN_VALID_DISTANCE_CM = 22.0;
const float MAX_VALID_DISTANCE_CM = 450.0;

// ========================================================
// TEMPERATURE COMPENSATION & CALIBRATION
// ========================================================
// Speed of sound changes with temperature: v = 331.3 + 0.606 * T (m/s)
// If you don't have a temperature sensor, set an estimated ambient temperature:
float ambientTemperatureC = 25.0; // In Celsius

// Calibration reference distance:
// MUST be outside the blind zone! Use at least 40 cm to 100 cm.
const float REFERENCE_DISTANCE_CM = 50.0; 

// Number of samples taken to extract the median
const int SAMPLES_COUNT = 9; 

// Calibration factor (default 1.0)
float calibrationFactor = 1.0;


// ========================================================
// SPEED OF SOUND CALCULATION (cm/us)
// ========================================================
float getSpeedOfSoundCmPerUs(float tempC) {
  // Speed in m/s: 331.3 + 0.606 * temp
  // Convert to cm/us: (m/s * 100) / 1,000,000 = (m/s) / 10,000
  float speed_m_s = 331.3 + (0.606 * tempC);
  return speed_m_s / 10000.0; 
}


// ========================================================
// LOW-LEVEL SINGLE PING
// ========================================================
float pingRawDistance() {
  // Ensure trigger pin is low
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(4);

  // Send a 20 microsecond trigger pulse
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(20);
  digitalWrite(TRIG_PIN, LOW);

  // Measure echo pulse width (timeout 40ms = approx 6.8 meters max)
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 40000);

  if (duration == 0) {
    return -1.0; // No echo received or timeout
  }

  // Calculate distance based on temperature-adjusted sound speed
  float speedCmPerUs = getSpeedOfSoundCmPerUs(ambientTemperatureC);
  float distance = (duration * speedCmPerUs) / 2.0;

  return distance;
}


// ========================================================
// FILTERED DISTANCE (MEDIAN FILTER FOR SPIKE REJECTION)
// ========================================================
// Ultrasonic sensors frequently pick up spurious echoes or multipath
// bounces in tanks. A median filter ignores extreme highs and lows.
float readFilteredDistance(int sampleSize = SAMPLES_COUNT) {
  float samples[15];
  if (sampleSize > 15) sampleSize = 15;

  int validCount = 0;

  for (int i = 0; i < sampleSize; i++) {
    float dist = pingRawDistance();

    // Check if the reading falls within valid physical boundaries
    if (dist >= MIN_VALID_DISTANCE_CM && dist <= MAX_VALID_DISTANCE_CM) {
      samples[validCount] = dist;
      validCount++;
    }

    // Required settling time between acoustic bursts
    // (Crucial for reverberations in tanks to decay)
    delay(75);
  }

  // If more than half the readings failed, treat reading as invalid
  if (validCount < (sampleSize / 2)) {
    return -1.0;
  }

  // Insertion sort the valid readings
  for (int i = 1; i < validCount; i++) {
    float key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  // Return the median sample
  if (validCount % 2 == 1) {
    return samples[validCount / 2];
  } else {
    return (samples[(validCount / 2) - 1] + samples[validCount / 2]) / 2.0;
  }
}


// ========================================================
// SENSOR CALIBRATION
// ========================================================
void calibrateSensor() {
  Serial.println("\n========================================");
  Serial.println("Starting SENSOR CALIBRATION");
  Serial.println("========================================");
  Serial.print("Target reference distance: ");
  Serial.print(REFERENCE_DISTANCE_CM, 2);
  Serial.println(" cm");
  Serial.println("Ensure target is perpendicular and stationary...");
  delay(2000);

  const int CALIBRATION_ROUNDS = 5;
  float sum = 0;
  int successfulRounds = 0;

  for (int r = 0; r < CALIBRATION_ROUNDS; r++) {
    Serial.print("Calibration pass ");
    Serial.print(r + 1);
    Serial.print(" of ");
    Serial.print(CALIBRATION_ROUNDS);
    Serial.print("... ");

    float d = readFilteredDistance(9);
    if (d > 0) {
      sum += d;
      successfulRounds++;
      Serial.print("Median: ");
      Serial.print(d, 2);
      Serial.println(" cm");
    } else {
      Serial.println("FAILED (No Echo or Out of Range)");
    }
    delay(200);
  }

  if (successfulRounds < 3) {
    Serial.println("\n[!] CALIBRATION FAILED: Not enough valid echoes.");
    Serial.println("Check: 5V supply, echo level shifter, and ensure distance is > 25cm.");
    calibrationFactor = 1.0;
    return;
  }

  float measuredAverage = sum / successfulRounds;
  calibrationFactor = REFERENCE_DISTANCE_CM / measuredAverage;

  Serial.println("\n========================================");
  Serial.println("CALIBRATION SUCCESSFUL");
  Serial.println("========================================");
  Serial.print("Measured distance: ");
  Serial.print(measuredAverage, 2);
  Serial.println(" cm");
  Serial.print("True reference:   ");
  Serial.print(REFERENCE_DISTANCE_CM, 2);
  Serial.println(" cm");
  Serial.print("Computed factor:   ");
  Serial.println(calibrationFactor, 6);
  Serial.println("========================================\n");
}


// ========================================================
// SETUP
// ========================================================
void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 2000);

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  digitalWrite(TRIG_PIN, LOW);

  Serial.println("\nJSN-SR04T High Accuracy Measurement System");
  Serial.println("Initializing...");

  delay(1000);

  // Run initial calibration
  calibrateSensor();
}


// ========================================================
// MAIN LOOP
// ========================================================
void loop() {
  float distance = readFilteredDistance(SAMPLES_COUNT);

  if (distance > 0) {
    float calibratedDistance = distance * calibrationFactor;

    Serial.print("Raw: ");
    Serial.print(distance, 2);
    Serial.print(" cm | Calibrated: ");
    Serial.print(calibratedDistance, 2);
    Serial.println(" cm");
  } else {
    Serial.println("Measurement Error / NO ECHO (Object out of range or in blind zone)");
  }

  delay(500);
}
