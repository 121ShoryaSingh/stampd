-- CreateEnum
CREATE TYPE "preset_status" AS ENUM ('active', 'archived');

-- CreateTable
CREATE TABLE "presets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "message" TEXT,
    "status" "preset_status" NOT NULL DEFAULT 'active',
    "version" INTEGER NOT NULL DEFAULT 1,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "last_used_at" TIMESTAMPTZ,
    "filename" TEXT,
    "s3_key" TEXT,
    "sha256" TEXT,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "page_sizes" JSONB NOT NULL DEFAULT '[]',
    "size_bytes" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "preset_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "role" "recipient_role" NOT NULL DEFAULT 'signer',
    "routing_order" INTEGER NOT NULL DEFAULT 1,
    "default_name" TEXT,
    "default_email" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "preset_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preset_fields" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "preset_id" UUID NOT NULL,
    "preset_role_id" UUID NOT NULL,
    "type" "field_type" NOT NULL,
    "page" INTEGER NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "w" DOUBLE PRECISION NOT NULL,
    "h" DOUBLE PRECISION NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "preset_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presets_tenant_id_status_idx" ON "presets"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "preset_roles_preset_id_idx" ON "preset_roles"("preset_id");

-- CreateIndex
CREATE INDEX "preset_fields_preset_id_idx" ON "preset_fields"("preset_id");

-- AddForeignKey
ALTER TABLE "presets" ADD CONSTRAINT "presets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "presets" ADD CONSTRAINT "presets_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_roles" ADD CONSTRAINT "preset_roles_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_fields" ADD CONSTRAINT "preset_fields_preset_id_fkey" FOREIGN KEY ("preset_id") REFERENCES "presets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preset_fields" ADD CONSTRAINT "preset_fields_preset_role_id_fkey" FOREIGN KEY ("preset_role_id") REFERENCES "preset_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Presets are private to their workspace, like envelopes.
do $$
declare t text;
begin
  foreach t in array array['presets', 'preset_roles', 'preset_fields'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format('create policy tenant_isolation on %I using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())', t);
  end loop;
end $$;
