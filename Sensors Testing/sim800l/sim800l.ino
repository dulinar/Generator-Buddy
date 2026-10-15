#include <HardwareSerial.h>

HardwareSerial sim800(2);

#define SIM800_RX 17   // SIM800L TXD -> ESP32 GPIO17
#define SIM800_TX 16   // SIM800L RXD -> ESP32 GPIO16

void setup() {
  Serial.begin(115200);

  sim800.begin(115200, SERIAL_8N1, SIM800_RX, SIM800_TX);

  delay(3000);

  Serial.println();
  Serial.println("=================================");
  Serial.println("       SIM800L AT COMMAND TESTER");
  Serial.println("=================================");
  Serial.println("Type an AT command and press Enter.");
  Serial.println();
  Serial.println("Examples:");
  Serial.println("AT");
  Serial.println("ATI");
  Serial.println("AT+CPIN?");
  Serial.println("AT+CSQ");
  Serial.println("AT+CREG?");
  Serial.println("AT+CGREG?");
  Serial.println("AT+CCID");
  Serial.println("AT+COPS?");
  Serial.println();
}

void loop() {

  // ESP32 Serial Monitor -> SIM800L
  if (Serial.available()) {

    String command = Serial.readStringUntil('\n');
    command.trim();

    if (command.length() > 0) {

      Serial.print("Sending: ");
      Serial.println(command);

      sim800.println(command);
    }
  }

  // SIM800L -> ESP32 Serial Monitor
  while (sim800.available()) {
    Serial.write(sim800.read());
  }
}