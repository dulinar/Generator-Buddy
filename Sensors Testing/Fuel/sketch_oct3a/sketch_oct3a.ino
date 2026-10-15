/*
 * JSN-SR04T V3.0 / V3.3 Ultrasonic Distance Sensor
 * Optimized for High Accuracy, Liquid / Fuel Tanks, and Outlier Rejection
 */

#define TRIG_PIN 5
#define ECHO_PIN 18

// 1. PHYSICAL SENSOR BOUNDARIES
// JSN-SR04T has a 20-25cm blind spot. Reject any echoes below this!
const float MIN_VALID_DISTANCE_CM = 22.0;
const float MAX_VALID_DISTANCE_CM = 450.0;

// 2. TEMPERATURE & CALIBRATION
float ambientTemperatureC = 25.0; // Set estimated temp or read from DS18B20 / DHT22
const float REFERENCE_DISTANCE_CM = 50.0; // MUST be >= 40 cm (outside blind zone)
const int SAMPLES_COUNT = 9;             // Number of samples for the median filter

float calibrationFactor = 1.0;

// Calculates sound velocity in cm/us based on Celsius temperature
float getSpeedOfSoundCmPerUs(float tempC) {
  float speed_m_s = 331.3 + (0.606 * tempC);
  return speed_m_s / 10000.0; 
}

// Single acoustic ping
float pingRawDistance() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(4);

  // Send 20 microsecond trigger pulse
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(20);
  digitalWrite(TRIG_PIN, LOW);

  // Measure echo pulse width (40ms timeout = ~6.8 meters max)
  unsigned long duration = pulseIn(ECHO_PIN, HIGH, 40000);

  if (duration == 0) {
    return -1.0; // Timeout or no echo
  }

  float speedCmPerUs = getSpeedOfSoundCmPerUs(ambientTemperatureC);
  return (duration * speedCmPerUs) / 2.0;
}

// Median Filter: Rejects multipath reflections, wave noise, and glitches
float readFilteredDistance(int sampleSize = SAMPLES_COUNT) {
  float samples[15];
  if (sampleSize > 15) sampleSize = 15;
  int validCount = 0;

  for (int i = 0; i < sampleSize; i++) {
    float dist = pingRawDistance();

    if (dist >= MIN_VALID_DISTANCE_CM && dist <= MAX_VALID_DISTANCE_CM) {
      samples[validCount++] = dist;
    }
    // Allow reverberations in enclosed tanks to decay completely
    delay(75);
  }

  // If majority of pings failed, return error
  if (validCount < (sampleSize / 2)) {
    return -1.0;
  }

  // Insertion sort
  for (int i = 1; i < validCount; i++) {
    float key = samples[i];
    int j = i - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  // Return the median reading
  if (validCount % 2 == 1) {
    return samples[validCount / 2];
  } else {
    return (samples[(validCount / 2) - 1] + samples[validCount / 2]) / 2.0;
  }
}

void calibrateSensor() {
  Serial.println("\nStarting SENSOR CALIBRATION...");
  Serial.print("Target reference distance: ");
  Serial.print(REFERENCE_DISTANCE_CM, 2);
  Serial.println(" cm");
  Serial.println("Place stationary target at least 40-50 cm away...");
  delay(2000);

  const int CALIBRATION_ROUNDS = 5;
  float sum = 0;
  int successfulRounds = 0;

  for (int r = 0; r < CALIBRATION_ROUNDS; r++) {
    float d = readFilteredDistance(9);
    if (d > 0) {
      sum += d;
      successfulRounds++;
      Serial.print("Round ");
      Serial.print(r + 1);
      Serial.print(": ");
      Serial.print(d, 2);
      Serial.println(" cm");
    } else {
      Serial.print("Round ");
      Serial.print(r + 1);
      Serial.println(": Failed (check distance/power)");
    }
    delay(200);
  }

  if (successfulRounds < 3) {
    Serial.println("[!] Calibration failed: Insufficient valid echoes.");
    calibrationFactor = 1.0;
    return;
  }

  float measuredAverage = sum / successfulRounds;
  calibrationFactor = REFERENCE_DISTANCE_CM / measuredAverage;

  Serial.println("CALIBRATION SUCCESSFUL!");
  Serial.print("Measured: ");
  Serial.print(measuredAverage, 2);
  Serial.print(" cm | Factor: ");
  Serial.println(calibrationFactor, 6);
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  digitalWrite(TRIG_PIN, LOW);

  delay(1000);
  calibrateSensor();
}

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
    Serial.println("NO ECHO / Out of Range (<22cm or >450cm)");
  }

  delay(500);
}