#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <BluetoothSerial.h>

extern BluetoothSerial SerialBT;

// Arduino IDE: classic ESP32, 4 MB flash, Huge APP partition.
// --- Communication Mode ---
#ifndef USE_WIFI_MODE
#define USE_WIFI_MODE       true    // true = WiFi, false = SIM800L GSM
#endif
#define BT_DEVICE_NAME      "Generator_Buddy"

#include "secrets.h"

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
#define PIN_JSN_TRIG        18       // Ultrasonic Trigger
#define PIN_JSN_ECHO        19      // Ultrasonic Echo
#define PIN_ZMPT101B        35      // AC Voltage OUT (ADC1)
#define PIN_ACS712          34      // Current OUT (ADC1)

// --- Sensor Calibration & Limits ---
#define TANK_HEIGHT_CM      100.0f  // Empty tank distance in cm
#define TANK_MIN_DIST_CM    22.0f   // Full tank distance (sensor blind zone 22cm)
#define VOLTAGE_CAL_FACTOR  450.0f  // Calibrate against a verified meter; never auto-calibrate at boot
#define CURRENT_SENSITIVITY 0.066f  // ACS712-30A sensitivity (66 mV/A)

// --- MQTT Broker Settings ---
const char MQTT_BROKER[]    = "141.148.197.200";
const int  MQTT_PORT        = 1884;

// --- Generator Identity ---
#define GENERATOR_ID        1
#define STR_HELPER(x)       #x
#define STR(x)              STR_HELPER(x)
#define MQTT_CLIENT_ID      "ESP32_Generator_" STR(GENERATOR_ID)
#define MQTT_TOPIC          "generator/" STR(GENERATOR_ID) "/readings"

// --- Timing & Delays ---
#define SERIAL_DEBUG_BAUD   115200
#define BOOT_WAIT_SECONDS   2      // Short startup; Bluetooth remains available
#define FUEL_SAMPLE_COUNT   5       // Median filter across five pings
#define PUBLISH_INTERVAL_MS 2000   // Telemetry interval (2 seconds)

// --- Runtime Tracking Mode ---
#define RUNTIME_COUNT_ALWAYS false   // true = increment runtime continuously while powered on
#define RUNTIME_SAVE_INTERVAL_S 60  // Save runtime to flash every 60 seconds (avoids flash wear)

// SSD1306 128x32 shares the RTC I2C bus.
#define OLED_I2C_ADDRESS 0x3C
#define NETWORK_RETRY_MS 15000UL
#define MQTT_RETRY_MS 5000UL

#endif // CONFIG_H
