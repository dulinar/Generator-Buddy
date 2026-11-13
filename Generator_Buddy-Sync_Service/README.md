# Generator MQTT to MySQL Sync Service

A simple, lightweight Node.js service that subscribes to incoming generator telemetry from a Mosquitto MQTT broker and writes the readings directly into a MySQL database (`generator_monitoring`).

---

## ⚙️ Configuration (`application.properties`)

All settings (MQTT, MySQL, and offline timeout) are managed in a single file: `application.properties`.

```properties
# Service
app.name=generator-sync-service

# Mosquitto MQTT Broker
mqtt.broker.url=mqtt://127.0.0.1:1883
mqtt.topic=generator/+/readings
mqtt.username=esp32
mqtt.password=Dulina123

# MySQL Database
db.host=127.0.0.1
db.port=3306
db.user=admin
db.password=Dulina123
db.name=generator_monitoring

# Inactivity Timeout (in seconds) - Marks generator 'offline' if no data arrives (60s = 1 minute)
generator.offline.timeout.seconds=60
generator.offline.check.interval.seconds=15
```

---

## 🚀 How to Run

### Option 1: Run with Node.js (Simplest)

```bash
# 1. Install dependencies
npm install

# 2. Start the service
npm start
```

### Option 2: Run with Docker / Docker Compose (Ubuntu aarch64 & x86)

```bash
# Build and run in background
docker compose up -d --build

# View live logs
docker compose logs -f

# Stop the service
docker compose down
```

---

## 📡 Message Format

### MQTT Topic
```
generator/{generator_id}/readings
```
*(Example: `generator/1/readings`)*

### JSON Payload
```json
{
  "recorded_at": "2026-09-26T14:32:10",
  "status": "running",
  "voltage": 231.5,
  "current": 12.3,
  "frequency": 50.1,
  "temperature": 78.4,
  "fuel_level": 68.0,
  "runtime_seconds": 154200
}
```
*(Note: Legacy field names `ac_voltage`, `ac_current`, and `engine_temp` are also automatically supported).*

### Database Actions
1. **`generator_readings` Table**: Inserts a new row with the RTC `recorded_at` timestamp, `status`, `voltage`, `current`, `frequency`, `temperature`, `fuel_level`, and `runtime_seconds`.
2. **`generators` Table**: Updates `status = ?` and `last_seen = CURRENT_TIMESTAMP` for the generator.
3. **Automatic Offline Inactivity Monitor**: If a generator does not send any telemetry within the configured timeout (`generator.offline.timeout.seconds=60`, i.e., 1 minute), the background monitor automatically updates its `status` to `'offline'` in the `generators` table.

---

## 🧪 Quick Test

To simulate an ESP32 sending data using `mosquitto_pub`:

```bash
mosquitto_pub -h 127.0.0.1 -p 1883 -u "esp32" -P "Dulina123" -t "generator/1/readings" -m '{
  "recorded_at": "2026-09-26T14:32:10",
  "status": "running",
  "voltage": 231.5,
  "current": 12.3,
  "frequency": 50.1,
  "temperature": 78.4,
  "fuel_level": 68.0,
  "runtime_seconds": 154200
}'
```
