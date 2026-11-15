#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

// Generator telemetry structure
struct GeneratorData {
  char     recorded_at[25];     // Timestamp "YYYY-MM-DDTHH:MM:SS"
  char     status[16];          // "running", "stopped", "fault"
  float    voltage;             // AC Voltage (V)
  float    current;             // Current (A)
  float    frequency;           // Frequency (Hz)
  float    temperature;         // Temperature (°C)
  float    fuel_level;          // Fuel level (%)
  bool voltage_valid, current_valid, frequency_valid;
  bool temperature_valid, fuel_valid, time_valid;
  uint32_t runtime_seconds;     // Runtime in seconds
};

bool initSensors();
void readSensors(GeneratorData &data);
void syncRtcWithTime(int year, int month, int day, int hour, int minute, int second);

// MQTT payload shared by Wi-Fi and GSM.
bool formatTelemetry(const GeneratorData &data, char *buffer, size_t capacity);

#endif // SENSORS_H
