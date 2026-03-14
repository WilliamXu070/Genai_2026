const DEFAULTS = {
  database: "jungle_dev",
  host: "127.0.0.1",
  password: "jungle_local_password",
  port: 5432,
  user: "jungle"
};

function getDatabaseConfig() {
  return {
    database: process.env.POSTGRES_DB || DEFAULTS.database,
    host: process.env.POSTGRES_HOST || DEFAULTS.host,
    password: process.env.POSTGRES_PASSWORD || DEFAULTS.password,
    port: Number(process.env.POSTGRES_PORT || DEFAULTS.port),
    user: process.env.POSTGRES_USER || DEFAULTS.user
  };
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL || "postgresql://jungle:jungle_local_password@localhost:5432/jungle_dev";
}

module.exports = {
  getDatabaseConfig,
  getDatabaseUrl
};
