-- AlterTable
ALTER TABLE "public"."Requisito" ADD COLUMN     "secretariaId" INTEGER;

-- AddForeignKey
ALTER TABLE "public"."Requisito" ADD CONSTRAINT "Requisito_secretariaId_fkey" FOREIGN KEY ("secretariaId") REFERENCES "public"."Secretaria"("id") ON DELETE SET NULL ON UPDATE CASCADE;
