#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <BluetoothSerial.h>

extern BluetoothSerial SerialBT;

// --- Communication Mode ---
#define USE_WIFI_MODE       true    // true = WiFi, false = SIM800L GSM
#define BT_DEVICE_NAME      "Generator_Buddy"

// --- WiFi Settings ---
const char WIFI_SSID[]      = "REDMI 15C";
const char WIFI_PASS[]      = "dulina123";
// const char WIFI_SSID[]      = "Byte Me";
// const char WIFI_PASS[]      = "Duli@2003";

// --- SIM800L Pins & APN ---
#define MODEM_RX_PIN        17      // ESP32 RX2 <- SIM800L TXD
#define MODEM_TX_PIN        16      // ESP32 TX2 -> SIM800L RXD
#define MODEM_RST_PIN       13
#define MODEM_BAUD          115200
const char GPRS_APN[]       = "dialogbb";
const char GPRS_USER[]      = "";
const char GPRS_PASS[]      = "";

// --- Hardware Pins ---
#define I2C_SDA_PIN         21      // RTC SDA
#define I2C_SCL_PIN         22      // RTC SCL
#define PIN_DS18B20         4       // Temperature (Yellow wire)
#define PIN_JSN_TRIG        5       // Ultrasonic Trigger
#define PIN_JSN_ECHO        18      // Ultrasonic Echo
#define PIN_ZMPT101B        35      // AC Voltage OUT (ADC1)
#define PIN_ACS712          34      // Current OUT (ADC1)

// --- Sensor Calibration & Limits ---
#define TANK_HEIGHT_CM      100.0f  // Empty tank distance in cm
#define TANK_MIN_DIST_CM    22.0f   // Full tank distance (sensor blind zone 22cm)
#define FUEL_REF_DIST_CM    50.0f   // Calibration reference distance in cm
#define REFERENCE_VOLTAGE   241.0f  // Known AC voltage for ZMPT101B auto-calibration
#define VOLTAGE_CAL_FACTOR  450.0f  // Default ZMPT101B factor when offline at boot
#define CURRENT_SENSITIVITY 0.066f  // ACS712-30A sensitivity (66 mV/A)

// --- MQTT Broker Settings ---
const char MQTT_BROKER[]    = "141.148.197.200";
const int  MQTT_PORT        = 1884;
const char MQTT_USER[]      = "esp32";
const char MQTT_PASS[]      = "Dulina123";

// --- Generator Identity ---
#define GENERATOR_ID        2
#define STR_HELPER(x)       #x
#define STR(x)              STR_HELPER(x)
#define MQTT_CLIENT_ID      "ESP32_Generator_" STR(GENERATOR_ID)
#define MQTT_TOPIC          "generator/" STR(GENERATOR_ID) "/readings"

// --- Timing ---
#define SERIAL_DEBUG_BAUD   115200
#define PUBLISH_INTERVAL_MS 2000   // Telemetry interval (30 seconds)

#endif // CONFIG_H
