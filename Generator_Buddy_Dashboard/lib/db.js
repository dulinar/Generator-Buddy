import mysql from "mysql2/promise";

// Database connection for Generator Buddy monitoring database.
const databaseConfig = {
  host: process.env.MYSQL_HOST || "localhost",
  port: Number(process.env.MYSQL_PORT) || 3307,
  user: process.env.MYSQL_USER || "generator_buddy",
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || "generator_monitoring",
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 10000,
  dateStrings: true,
};
export const pool = mysql.createPool(databaseConfig);
