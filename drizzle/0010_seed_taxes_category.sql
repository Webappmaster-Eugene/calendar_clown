-- Add the «Налоги» expense category (taxes, duties, fines). Reference data, so it
-- ships as a guarded custom migration like the other category seeds. Idempotent via
-- the unique name. The "федеральная налоговая служба" alias lets future ФНС bank
-- pushes route here instead of «Ипотека» (the matcher is prefix-anchored, and that
-- is exactly how the merchant string starts).

INSERT INTO "categories" ("name", "emoji", "sort_order", "aliases", "description") VALUES
  (
    'Налоги',
    '🧾',
    27,
    ARRAY['налоги','налог','фнс','федеральная налоговая служба','налоговая','ндфл','штраф','штрафы','гибдд','пеня','транспортный налог','налог на имущество'],
    'Налоги, сборы и штрафы: ФНС, НДФЛ, транспортный и имущественный налог, штрафы ГИБДД, пени. Платежи по ипотеке — в «Ипотека».'
  )
ON CONFLICT ("name") DO NOTHING;
