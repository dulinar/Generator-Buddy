#include "config.h"

#if USE_WIFI_MODE

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>
#include "wifi_comm.h"

static WiFiClient wifiClient;
static PubSubClient wifiMqttClient(wifiClient);
static unsigned long lastWiFiMqttReconnect = 0;

static bool connectWiFiMqtt() {
  SerialBT.print("[WIFI-MQTT] Connecting to broker... ");
  bool ok = (strlen(MQTT_USER) > 0)
    ? wifiMqttClient.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)
    : wifiMqttClient.connect(MQTT_CLIENT_ID);

  SerialBT.println(ok ? "Connected!" : "Failed!");
  return ok;
}

void initWiFiCommunication() {
  SerialBT.print("[WIFI] Connecting to ");
  SerialBT.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    SerialBT.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    SerialBT.print("\n[WIFI] Connected! IP: ");
    SerialBT.println(WiFi.localIP());

    // Sync time with NTP for Sri Lanka (UTC+5:30 = 19800 seconds)
    configTime(19800, 0, "pool.ntp.org", "time.google.com");
    struct tm timeinfo;
    if (getLocalTime(&timeinfo, 3000)) {
      SerialBT.printf("[NTP] Sri Lanka Time Synced: %04d-%02d-%02d %02d:%02d:%02d\n",
                      timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                      timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
      // Synchronize hardware DS3231 RTC module with exact Sri Lanka time!
      syncRtcWithTime(timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                      timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    }
  } else {
    SerialBT.println("\n[WIFI] Connection failed!");
  }

  wifiMqttClient.setServer(MQTT_BROKER, MQTT_PORT);
  wifiMqttClient.setBufferSize(512);

  if (WiFi.status() == WL_CONNECTED) {
    connectWiFiMqtt();
  }
}

void maintainWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.disconnect();
    WiFi.reconnect();
    return;
  }

  if (!wifiMqttClient.connected()) {
    unsigned long now = millis();
    if (now - lastWiFiMqttReconnect >= 5000) {
      lastWiFiMqttReconnect = now;
      connectWiFiMqtt();
    }
  } else {
    wifiMqttClient.loop();
  }
}

bool publishWiFiTelemetry(const GeneratorData &data) {
  if (!wifiMqttClient.connected()) return false;

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

  SerialBT.print("[WIFI-MQTT] Publish: ");
  SerialBT.println(payload);

  return wifiMqttClient.publish(MQTT_TOPIC, payload);
}

#endif // USE_WIFI_MODE
