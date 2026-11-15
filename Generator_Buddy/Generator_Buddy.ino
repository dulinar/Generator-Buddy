#include "config.h"
#include "sensors.h"
#include "display.h"
#include <Wire.h>
#if USE_WIFI_MODE
#include "wifi_comm.h"
#else
#include "Generator-Buddy.h"
#endif

BluetoothSerial SerialBT;
static unsigned long lastRead = 0;

void setup() {
  Serial.begin(SERIAL_DEBUG_BAUD);
  SerialBT.begin(BT_DEVICE_NAME);
  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  if (!initDisplay()) Serial.println("OLED not found; continuing without it.");
  delay(BOOT_WAIT_SECONDS * 1000UL);
  initSensors();
#if USE_WIFI_MODE
  initWiFiCommunication();
#else
  initCommunication();
#endif
  lastRead = millis() - PUBLISH_INTERVAL_MS;
}

void loop() {
#if USE_WIFI_MODE
  maintainWiFiConnection();
#else
  maintainConnection();
#endif

  if (millis() - lastRead >= PUBLISH_INTERVAL_MS) {
    lastRead = millis();
    GeneratorData data = {};
    readSensors(data);
    updateDisplayReadings(data);
#if USE_WIFI_MODE
    bool sent = publishWiFiTelemetry(data);
#else
    bool sent = publishTelemetry(data);
#endif
    if (!sent) SerialBT.println("MQTT unavailable; reading shown locally.");
  }
  refreshDisplay();
  delay(1);
}
