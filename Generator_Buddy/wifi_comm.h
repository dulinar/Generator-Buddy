#ifndef WIFI_COMM_H
#define WIFI_COMM_H

#include <Arduino.h>
#include "sensors.h"

void initWiFiCommunication();
void maintainWiFiConnection();
bool publishWiFiTelemetry(const GeneratorData &data);

#endif // WIFI_COMM_H
