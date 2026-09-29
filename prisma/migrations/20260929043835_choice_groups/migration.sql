-- CreateEnum
CREATE TYPE "choice_mark" AS ENUM ('check', 'cross', 'circle', 'text');

-- AlterTable
ALTER TABLE "fields" ADD COLUMN     "group_key" TEXT,
ADD COLUMN     "mark" "choice_mark",
ADD COLUMN     "option" TEXT;

-- AlterTable
ALTER TABLE "preset_fields" ADD COLUMN     "group_key" TEXT,
ADD COLUMN     "mark" "choice_mark",
ADD COLUMN     "option" TEXT;

-- Earlier choice fields were one box answered "yes"/"no". Split each into a two-box
-- question (left half "Yes", right half "No"), written as text like before.
-- The chosen box now holds "true", the other "false".
INSERT INTO "fields" (id, tenant_id, envelope_id, document_id, recipient_id, type, page, x, y, w, h, required, value, created_at, group_key, option, mark)
SELECT gen_random_uuid(), tenant_id, envelope_id, document_id, recipient_id, type, page, x + w / 2, y, w / 2, h, required,
       CASE value WHEN 'no' THEN 'true' WHEN 'yes' THEN 'false' END, created_at, id::text, 'No', 'text'
FROM "fields" WHERE type = 'choice' AND group_key IS NULL;

UPDATE "fields"
SET w = w / 2, group_key = id::text, option = 'Yes', mark = 'text',
    value = CASE value WHEN 'yes' THEN 'true' WHEN 'no' THEN 'false' END
WHERE type = 'choice' AND group_key IS NULL;

INSERT INTO "preset_fields" (id, tenant_id, preset_id, preset_role_id, type, page, x, y, w, h, required, group_key, option, mark)
SELECT gen_random_uuid(), tenant_id, preset_id, preset_role_id, type, page, x + w / 2, y, w / 2, h, required, id::text, 'No', 'text'
FROM "preset_fields" WHERE type = 'choice' AND group_key IS NULL;

UPDATE "preset_fields"
SET w = w / 2, group_key = id::text, option = 'Yes', mark = 'text'
WHERE type = 'choice' AND group_key IS NULL;

-- A choice box always belongs to a question; other fields never do.
ALTER TABLE "fields" ADD CONSTRAINT "fields_choice_shape" CHECK ((type = 'choice') = (group_key IS NOT NULL AND option IS NOT NULL AND mark IS NOT NULL));
ALTER TABLE "preset_fields" ADD CONSTRAINT "preset_fields_choice_shape" CHECK ((type = 'choice') = (group_key IS NOT NULL AND option IS NOT NULL AND mark IS NOT NULL));
