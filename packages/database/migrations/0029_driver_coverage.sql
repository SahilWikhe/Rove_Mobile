ALTER TABLE drivers ADD COLUMN coverage_radius_miles integer NOT NULL DEFAULT 25 CONSTRAINT driver_coverage_radius_range CHECK (coverage_radius_miles BETWEEN 1 AND 100);
