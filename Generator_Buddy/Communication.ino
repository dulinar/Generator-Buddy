#include "config.h"
#include "sensors.h"
#if USE_WIFI_MODE
  #include "wifi_comm.h"
#else
  #include "communication.h"
#endif

BluetoothSerial SerialBT;
static unsigned long lastPublishTime = 0;

void setup() {
  Serial.begin(SERIAL_DEBUG_BAUD);
  SerialBT.begin(BT_DEVICE_NAME);
  delay(1000);

  SerialBT.println("\n==========================================");
  SerialBT.println(" ESP32 Generator Monitor (Bluetooth Debug)");
  SerialBT.println("==========================================");

  // Initialize sensors and network communication
  initSensors();

#if USE_WIFI_MODE
  initWiFiCommunication();
#else
  initCommunication();
#endif

  SerialBT.println("System ready.\n");
}

void loop() {
  // Maintain network and MQTT connection
#if USE_WIFI_MODE
  maintainWiFiConnection();
#else
  maintainConnection();
#endif

  // Periodic telemetry publish
  unsigned long now = millis();
  if (now - lastPublishTime >= PUBLISH_INTERVAL_MS) {
    lastPublishTime = now;

    GeneratorData telemetry;
    readSensors(telemetry);

#if USE_WIFI_MODE
    publishWiFiTelemetry(telemetry);
#else
    publishTelemetry(telemetry);
#endif
  }
}
