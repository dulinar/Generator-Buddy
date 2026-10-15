#define ZMPT_PIN 35

const float ADC_REF = 3.3;
const int ADC_MAX = 4095;

// Your known AC voltage measured with a multimeter
const float REFERENCE_VOLTAGE = 241.0;

float calibrationFactor = 1.0;

// --------------------------------------------------
// Measure ZMPT101B sensor RMS voltage
// --------------------------------------------------
float measureSensorRMS() {

  const int samples = 2000;

  double sum = 0;
  double sumSquares = 0;

  for (int i = 0; i < samples; i++) {

    int adc = analogRead(ZMPT_PIN);

    float voltage = (adc * ADC_REF) / ADC_MAX;

    sum += voltage;
    sumSquares += voltage * voltage;

    delayMicroseconds(200);
  }

  // DC offset
  float mean = sum / samples;

  // AC RMS
  float variance =
      (sumSquares / samples) - (mean * mean);

  if (variance < 0)
    variance = 0;

  return sqrt(variance);
}


// --------------------------------------------------
// Setup
// --------------------------------------------------
void setup() {

  Serial.begin(115200);

  analogReadResolution(12);
  analogSetPinAttenuation(ZMPT_PIN, ADC_11db);

  Serial.println();
  Serial.println("=================================");
  Serial.println(" ZMPT101B AUTO CALIBRATION");
  Serial.println("=================================");

  delay(2000);

  // Measure sensor RMS
  float sensorRMS = measureSensorRMS();

  Serial.print("Sensor RMS = ");
  Serial.print(sensorRMS, 4);
  Serial.println(" V");

  // Calculate calibration factor
  if (sensorRMS > 0.001) {

    calibrationFactor =
        REFERENCE_VOLTAGE / sensorRMS;

    Serial.print("Calibration Factor = ");
    Serial.println(calibrationFactor, 2);

    Serial.println("Calibration completed!");

  } else {

    Serial.println("ERROR: Sensor RMS too low!");
    Serial.println("Check ZMPT101B wiring.");
  }

  Serial.println();
}


// --------------------------------------------------
// Main loop
// --------------------------------------------------
void loop() {

  float sensorRMS = measureSensorRMS();

  float acVoltage =
      sensorRMS * calibrationFactor;

  Serial.print("Sensor RMS: ");
  Serial.print(sensorRMS, 4);

  Serial.print(" V | AC Voltage: ");
  Serial.print(acVoltage, 1);

  Serial.println(" V");

  delay(1000);
}