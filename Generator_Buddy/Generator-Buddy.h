#ifndef COMMUNICATION_H
#define COMMUNICATION_H

#include <Arduino.h>
#include "sensors.h"

void initCommunication();
void maintainConnection();
bool publishTelemetry(const GeneratorData &data);

#endif // COMMUNICATION_H
