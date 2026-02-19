-- CreateTable
CREATE TABLE "public"."SubRequisito" (
    "id" SERIAL NOT NULL,
    "texto" TEXT NOT NULL,
    "linkFixo" TEXT,
    "ordem" INTEGER NOT NULL,
    "requisitoPaiId" INTEGER NOT NULL,

    CONSTRAINT "SubRequisito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubResposta" (
    "id" SERIAL NOT NULL,
    "atende" BOOLEAN NOT NULL DEFAULT false,
    "linkComprovante" TEXT,
    "comentarioSecretaria" TEXT,
    "comentarioAdmin" TEXT,
    "comentarioRecurso" TEXT,
    "comentarioAnaliseFinal" TEXT,
    "statusValidacao" TEXT DEFAULT 'pendente',
    "statusValidacaoPosRecurso" TEXT DEFAULT 'pendente',
    "subRequisitoId" INTEGER NOT NULL,
    "respostaId" INTEGER NOT NULL,

    CONSTRAINT "SubResposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."SubEvidencia" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'original',
    "url" TEXT NOT NULL,
    "subRespostaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubEvidencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SubRequisito_requisitoPaiId_ordem_key" ON "public"."SubRequisito"("requisitoPaiId", "ordem");

-- CreateIndex
CREATE UNIQUE INDEX "SubResposta_respostaId_subRequisitoId_key" ON "public"."SubResposta"("respostaId", "subRequisitoId");

-- AddForeignKey
ALTER TABLE "public"."SubRequisito" ADD CONSTRAINT "SubRequisito_requisitoPaiId_fkey" FOREIGN KEY ("requisitoPaiId") REFERENCES "public"."Requisito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubResposta" ADD CONSTRAINT "SubResposta_subRequisitoId_fkey" FOREIGN KEY ("subRequisitoId") REFERENCES "public"."SubRequisito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubResposta" ADD CONSTRAINT "SubResposta_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "public"."Resposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."SubEvidencia" ADD CONSTRAINT "SubEvidencia_subRespostaId_fkey" FOREIGN KEY ("subRespostaId") REFERENCES "public"."SubResposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;
