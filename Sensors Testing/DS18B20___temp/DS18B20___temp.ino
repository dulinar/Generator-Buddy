#include <OneWire.h>
#include <DallasTemperature.h>

#define ONE_WIRE_BUS 4

OneWire oneWire(ONE_WIRE_BUS);
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(115200);
  sensors.begin();

  Serial.println("DS18B20 Test");
}

void loop() {
  sensors.requestTemperatures();

  float tempC = sensors.getTempCByIndex(0);

  if (tempC == DEVICE_DISCONNECTED_C) {
    Serial.println("ERROR: DS18B20 not detected!");
  } else {
    Serial.print("Temperature: ");
    Serial.print(tempC);
    Serial.println(" °C");
  }

  delay(1000);
}
