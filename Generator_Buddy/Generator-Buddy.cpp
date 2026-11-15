#include "config.h"
#if !USE_WIFI_MODE
#define TINY_GSM_MODEM_SIM800
#define TINY_GSM_RX_BUFFER 650
#include <HardwareSerial.h>
#include <TinyGsmClient.h>
#include <PubSubClient.h>
#include "Generator-Buddy.h"
#include "display.h"

static HardwareSerial serialAT(2);
static TinyGsm modem(serialAT);
static TinyGsmClient gsmClient(modem);
static PubSubClient mqtt(gsmClient);
static uint32_t lastNetworkAttempt = 0, lastMqttAttempt = 0;
static bool modemReady = false, networkReady = false, triedMqtt = false;

void initCommunication() {
  showDisplayStage("Starting modem", "SIM800L...");
  setDisplayConnection(ConnectionState::Connecting);
  serialAT.begin(MODEM_BAUD, SERIAL_8N1, MODEM_RX_PIN, MODEM_TX_PIN);
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(768);
  mqtt.setSocketTimeout(2);
  // First attempt is performed by maintainConnection, after sensors can run.
  lastNetworkAttempt = millis() - NETWORK_RETRY_MS;
}

void maintainConnection() {
  uint32_t now = millis();
  if (!networkReady && now - lastNetworkAttempt >= NETWORK_RETRY_MS) {
    setDisplayConnection(ConnectionState::Connecting);
    refreshDisplay();
    if (!modemReady) modemReady = modem.init();
    networkReady = modemReady && modem.waitForNetwork(1000L) &&
                   modem.gprsConnect(GPRS_APN, GPRS_USER, GPRS_PASS);
    lastNetworkAttempt = millis();
    if (!networkReady) {
      setDisplayConnection(ConnectionState::NetworkFailed);
      SerialBT.println("[GSM] Network unavailable; retry scheduled");
    }
  }
  if (!networkReady) return;
  if (!mqtt.connected()) {
    setDisplayConnection(ConnectionState::BrokerFailed);
    if (!triedMqtt || now - lastMqttAttempt >= MQTT_RETRY_MS) {
      triedMqtt = true;
      networkReady = modem.isGprsConnected();
      bool ok = networkReady && (strlen(MQTT_USER) ? mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)
                                                  : mqtt.connect(MQTT_CLIENT_ID));
      lastMqttAttempt = millis();
      if (!networkReady) lastNetworkAttempt = millis();
      setDisplayConnection(ok ? ConnectionState::Online :
        (networkReady ? ConnectionState::BrokerFailed : ConnectionState::NetworkFailed));
    }
  } else {
    mqtt.loop();
    setDisplayConnection(mqtt.connected() ? ConnectionState::Online : ConnectionState::BrokerFailed);
  }
}

bool publishTelemetry(const GeneratorData &data) {
  if (!mqtt.connected()) return false;
  char payload[640];
  return formatTelemetry(data, payload, sizeof(payload)) && mqtt.publish(MQTT_TOPIC, payload);
}
#endif
