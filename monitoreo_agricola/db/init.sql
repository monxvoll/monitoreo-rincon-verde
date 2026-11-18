CREATE TABLE IF NOT EXISTS lecturas (
    id BIGSERIAL PRIMARY KEY,
    finca_id TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    temperatura DOUBLE PRECISION NOT NULL,
    humedad DOUBLE PRECISION NOT NULL,
    co2 DOUBLE PRECISION NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lecturas_finca_ts
    ON lecturas (finca_id, ts DESC);

CREATE OR REPLACE FUNCTION notificar_lectura() RETURNS trigger AS $$
BEGIN
    PERFORM pg_notify(
        'fincas_updates',
        json_build_object(
            'finca_id', NEW.finca_id,
            'timestamp', NEW.ts,
            'temperatura', NEW.temperatura,
            'humedad', NEW.humedad,
            'co2', NEW.co2
        )::text
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notificar_lectura ON lecturas;

CREATE TRIGGER trg_notificar_lectura
AFTER INSERT ON lecturas
FOR EACH ROW
EXECUTE FUNCTION notificar_lectura();
