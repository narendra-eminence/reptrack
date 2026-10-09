-- Cleaning details moved into config.yaml next to their brand set. A database that applied the first version of
-- migration 3 has this table; it held nothing a cleaning still reads.
DROP TABLE IF EXISTS cleaning_details;
