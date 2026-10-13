#ifndef SENSORS_H
#define SENSORS_H

#include <Arduino.h>

// Generator telemetry structure
struct GeneratorData {
  char     recorded_at[25];     // Timestamp "YYYY-MM-DDTHH:MM:SS"
  char     status[16];          // "running", "offline"
  float    voltage;             // AC Voltage (V)
  float    current;             // Current (A)
  float    frequency;           // Frequency (Hz)
  float    temperature;         // Temperature (°C)
  float    fuel_level;          // Fuel level (%)
  uint32_t runtime_seconds;     // Runtime in seconds
};

bool initSensors();
void readSensors(GeneratorData &data);

#endif // SENSORS_H
