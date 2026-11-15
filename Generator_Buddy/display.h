#ifndef GENERATOR_DISPLAY_H
#define GENERATOR_DISPLAY_H

#include "sensors.h"

// SSD1306 128x32, address 0x3C. Shares I2C with the RTC:
// VCC -> 3V3, GND -> GND, SDA -> GPIO21, SCL -> GPIO22.
// Libraries: Adafruit SSD1306 and Adafruit GFX.
enum class ConnectionState { Connecting, NetworkFailed, BrokerFailed, Online };
bool initDisplay();
void showDisplayStage(const char *stage, const char *detail = "");
void setDisplayConnection(ConnectionState state);
void updateDisplayReadings(const GeneratorData &data);
void refreshDisplay();

#endif
