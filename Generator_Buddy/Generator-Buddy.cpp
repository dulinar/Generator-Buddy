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

  char payload[384];
  snprintf(payload, sizeof(payload),
    "{\"recorded_at\":\"%s\",\"status\":\"%s\",\"voltage\":%.1f,\"current\":%.1f,\"frequency\":%.1f,\"temperature\":%.1f,\"fuel_level\":%.1f,\"runtime_seconds\":%lu}",
    data.recorded_at,
    data.status,
    data.voltage,
    data.current,
    data.frequency,
    data.temperature,
    data.fuel_level,
    (unsigned long)data.runtime_seconds
  );

  SerialBT.print("[GSM-MQTT] Publish: ");
  SerialBT.println(payload);

  return mqttClient.publish(MQTT_TOPIC, payload);
}

#endif // !USE_WIFI_MODE
