
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 32

#define SDA_PIN 21
#define SCL_PIN 22

Adafruit_SSD1306 display(
  SCREEN_WIDTH,
  SCREEN_HEIGHT,
  &Wire,
  -1
);

int counter = 0;

void setup() {
  Serial.begin(115200);

  Wire.begin(SDA_PIN, SCL_PIN);

  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED not found!");
    while (true) {
      delay(1000);
    }
  }

  display.clearDisplay();
  display.setTextColor(SSD1306_WHITE);
  display.setTextSize(1);

  display.setCursor(0, 0);
  display.println("Hello ESP32!");

  display.setCursor(0, 12);
  display.println("OLED Test OK");

  display.display();
  delay(2000);
}

void loop() {
  display.clearDisplay();

  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("ESP32 OLED TEST");

  display.setCursor(0, 16);
  display.print("Counter: ");
  display.println(counter);

  display.display();

  Serial.println(counter);

  counter++;
  delay(1000);
}
