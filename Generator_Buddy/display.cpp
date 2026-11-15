#include "display.h"
#include "config.h"
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <math.h>

static Adafruit_SSD1306 oled(128, 32, &Wire, -1);
static bool ready = false, haveReading = false;
static ConnectionState connection = ConnectionState::Connecting;
static GeneratorData latest = {};
static uint8_t stableCount = 0;
static unsigned long lastFrame = 0;

static void clearScreen() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextWrap(false);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
}

bool initDisplay() {
  Wire.beginTransmission(OLED_I2C_ADDRESS);
  if (Wire.endTransmission() != 0) return false;
  ready = oled.begin(SSD1306_SWITCHCAPVCC, OLED_I2C_ADDRESS, true, false);
  showDisplayStage("Starting system", "Please wait...");
  return ready;
}

void showDisplayStage(const char *stage, const char *detail) {
  if (!ready) return;
  clearScreen();
  oled.print("GENERATOR BUDDY");
  oled.setCursor(0, 12); oled.print(stage);
  oled.setCursor(0, 24); oled.print(detail);
  oled.display();
}

void setDisplayConnection(ConnectionState state) {
  connection = state;
}

void updateDisplayReadings(const GeneratorData &data) {
  // Three healthy samples within 5 V indicate settled readings.
  if (strcmp(data.status, "fault") == 0) stableCount = 0;
  else if (!haveReading || strcmp(data.status, latest.status) != 0 ||
           fabsf(data.voltage - latest.voltage) > 5.0f) stableCount = 1;
  else if (stableCount < 3) ++stableCount;
  latest = data;
  haveReading = true;
  lastFrame = millis() - 500;
}

void refreshDisplay() {
  if (!ready || !haveReading || millis() - lastFrame < 500) return;
  lastFrame = millis();
  clearScreen();

  if ((millis() / 3000) % 2 == 0) oled.print("GENERATOR BUDDY");
  else if (connection == ConnectionState::NetworkFailed) oled.print("Network failed: retry");
  else if (connection == ConnectionState::BrokerFailed) oled.print("MQTT failed: retry");
  else if (connection == ConnectionState::Connecting) oled.print("Connecting...");
  else if (!strcmp(latest.status, "fault")) oled.print("Check sensors");
  else if (stableCount < 3) oled.print("Settling readings...");
  else oled.print(!strcmp(latest.status, "running") ? "Working - RUNNING" : "Ready - STOPPED");

  oled.setCursor(0, 10); oled.setTextSize(2);
  if (latest.voltage_valid) oled.printf("%.0f V", latest.voltage);
  else oled.print("-- V");
  oled.setTextSize(1); oled.setCursor(88, 14);
  oled.print(connection == ConnectionState::Online ? "ONLINE" : "LOCAL");
  oled.setCursor(0, 25);
  if (latest.current_valid) oled.printf("%.1f A", latest.current); else oled.print("-- A");
  oled.print("   ");
  if (latest.frequency_valid) oled.printf("%.1f Hz", latest.frequency); else oled.print("-- Hz");
  oled.display();
}
