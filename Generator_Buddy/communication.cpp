#include "config.h"

#if !USE_WIFI_MODE

#define TINY_GSM_MODEM_SIM800
#define TINY_GSM_RX_BUFFER 650

#include <HardwareSerial.h>
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "communication.h"

static HardwareSerial SerialAT(2);
static TinyGsm modem(SerialAT);
static TinyGsmClient gsmClient(modem);
static PubSubClient mqttClient(gsmClient);
static unsigned long lastMqttReconnect = 0;

static bool connectMqtt() {
  SerialBT.print("[GSM-MQTT] Connecting to broker... ");
  bool ok = (strlen(MQTT_USER) > 0)
    ? mqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)
    : mqttClient.connect(MQTT_CLIENT_ID);

  SerialBT.println(ok ? "Connected!" : "Failed!");
  return ok;
}

void initCommunication() {
  SerialBT.println("[GSM] Starting modem...");
  SerialAT.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  delay(1000);

  // Sync baud rate
  for (int i = 0; i < 5; i++) {
    SerialAT.println("AT");
    delay(300);
  }

  if (!modem.init()) {
    SerialBT.println("[GSM] Modem init failed, retrying...");
    modem.init();
  }

  SerialBT.print("[GSM] Waiting for network... ");
  if (modem.waitForNetwork(60000L)) {
    SerialBT.println("OK");
  } else {
    SerialBT.println("Timeout!");
  }

  SerialBT.print("[GPRS] Connecting to APN: ");
  SerialBT.println(GPRS_APN);
  modem.gprsConnect(GPRS_APN, GPRS_USER, GPRS_PASS);

  mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  mqttClient.setBufferSize(512);
  connectMqtt();
}

void maintainConnection() {
  if (!modem.isGprsConnected()) {
    modem.gprsConnect(GPRS_APN, GPRS_USER, GPRS_PASS);
  }

  if (!mqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastMqttReconnect >= 5000) {
      lastMqttReconnect = now;
      connectMqtt();
    }
  } else {
    mqttClient.loop();
  }
}

bool publishTelemetry(const GeneratorData &data) {
  if (!mqttClient.connected()) return false;

  JsonDocument doc;
  doc["recorded_at"]     = data.recorded_at;
  doc["status"]          = data.status;
  doc["voltage"]         = serialized(String(data.voltage, 1));
  doc["current"]         = serialized(String(data.current, 1));
  doc["frequency"]       = serialized(String(data.frequency, 1));
  doc["temperature"]     = serialized(String(data.temperature, 1));
  doc["fuel_level"]      = serialized(String(data.fuel_level, 2));
  doc["runtime_seconds"] = data.runtime_seconds;

  char payload[384];
  serializeJson(doc, payload, sizeof(payload));

  SerialBT.print("[GSM-MQTT] Publish: ");
  SerialBT.println(payload);

  return mqttClient.publish(MQTT_TOPIC, payload);
}

#endif // !USE_WIFI_MODE
