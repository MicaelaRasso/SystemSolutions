-- E1 (#94), decisión (e) de la usuaria (2026-11-16): estado nuevo «Requiere finalización» para
-- la visita iniciada que no se completó antes de las 23:59 (hora de Argentina) del día en que el
-- técnico la inició. Lo asigna el cierre automático (#95).
--
-- Va solo en esta migración: un valor agregado con `alter type ... add value` no se puede usar en
-- la misma transacción. La restricción de estado y las funciones que lo usan están en
-- 20261116120100_visit_estimated_end_and_started_at.sql.
alter type public.estado_visita add value if not exists 'requiere_finalizacion' after 'en_curso';
