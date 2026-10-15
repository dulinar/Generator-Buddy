#include <Wire.h>

#define SDA_PIN 21
#define SCL_PIN 22

void setup() {
  Serial.begin(115200);

  Wire.begin(SDA_PIN, SCL_PIN);

  Serial.println();
  Serial.println("I2C Scanner");
  Serial.println("Scanning...");

  byte deviceCount = 0;

  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);

    byte error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("I2C device found at address 0x");
      
      if (address < 16) {
        Serial.print("0");
      }

      Serial.println(address, HEX);

      deviceCount++;
    }
  }

  if (deviceCount == 0) {
    Serial.println("No I2C devices found.");
  } else {
    Serial.print("Found ");
    Serial.print(deviceCount);
    Serial.println(" I2C device(s).");
  }
}

void loop() {
}