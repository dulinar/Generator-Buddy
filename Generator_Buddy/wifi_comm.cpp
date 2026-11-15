#include "config.h"
#if USE_WIFI_MODE
#include <WiFi.h>
#include <PubSubClient.h>
#include <time.h>
#include "wifi_comm.h"
#include "display.h"

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);
static uint32_t lastNetworkAttempt = 0, lastMqttAttempt = 0, lastRtcSync = 0;
static bool ntpStarted = false, rtcSynced = false, triedMqtt = false;
static bool networkWasConnected = false;

void initWiFiCommunication() {
  showDisplayStage("Starting Wi-Fi", "Connecting...");
  setDisplayConnection(ConnectionState::Connecting);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  lastNetworkAttempt = millis();
  mqtt.setServer(MQTT_BROKER, MQTT_PORT);
  mqtt.setBufferSize(768);
  mqtt.setSocketTimeout(2);
  wifiClient.setConnectionTimeout(2000);
}

void maintainWiFiConnection() {
  uint32_t now = millis();
  if (WiFi.status() != WL_CONNECTED) {
    if (networkWasConnected) {
      setDisplayConnection(ConnectionState::NetworkFailed);
      networkWasConnected = false;
      wifiClient.stop();
    }
    if (now - lastNetworkAttempt >= NETWORK_RETRY_MS) {
      setDisplayConnection(ConnectionState::NetworkFailed);
      SerialBT.println("[WiFi] Connection unavailable; retrying");
      // Let each asynchronous association attempt finish before trying again.
      WiFi.reconnect();
      lastNetworkAttempt = now;
    }
    return;
  }
  networkWasConnected = true;
  if (!ntpStarted) {
    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    ntpStarted = true;
  }
  struct tm ti;
  bool timeReady = getLocalTime(&ti, 0);
  if (timeReady && (!rtcSynced || now - lastRtcSync >= 3600000UL)) {
    syncRtcWithTime(ti.tm_year + 1900, ti.tm_mon + 1, ti.tm_mday,
                    ti.tm_hour, ti.tm_min, ti.tm_sec);
    lastRtcSync = now;
    rtcSynced = true;
  }
  if (!mqtt.connected()) {
    setDisplayConnection(ConnectionState::BrokerFailed);
    if (!triedMqtt || now - lastMqttAttempt >= MQTT_RETRY_MS) {
      triedMqtt = true;
      refreshDisplay();
      bool ok = strlen(MQTT_USER) ? mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)
                                  : mqtt.connect(MQTT_CLIENT_ID);
      lastMqttAttempt = millis();
      SerialBT.println(ok ? "[MQTT] Connected" : "[MQTT] Connection failed; retry scheduled");
      setDisplayConnection(ok ? ConnectionState::Online : ConnectionState::BrokerFailed);
    }
  } else {
    mqtt.loop();
    setDisplayConnection(mqtt.connected() ? ConnectionState::Online : ConnectionState::BrokerFailed);
  }
}

bool publishWiFiTelemetry(const GeneratorData &data) {
  if (!mqtt.connected()) return false;
  char payload[640];
  return formatTelemetry(data, payload, sizeof(payload)) && mqtt.publish(MQTT_TOPIC, payload);
}
#endif
