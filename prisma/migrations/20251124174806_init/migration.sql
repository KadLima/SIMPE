-- CreateEnum
CREATE TYPE "public"."AvaliacaoStatus" AS ENUM ('PENDENTE_SECRETARIA', 'EM_ANALISE_SCGE', 'AGUARDANDO_RECURSO', 'EM_ANALISE_DE_RECURSO', 'FINALIZADA');

-- CreateTable
CREATE TABLE "public"."ScanSession" (
    "id" TEXT NOT NULL,
    "url_base" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'iniciado',
    "total_links" INTEGER NOT NULL DEFAULT 0,
    "depthReached" INTEGER,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScanSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Link" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "finalUrl" TEXT,
    "tipo" TEXT NOT NULL,
    "origem" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpCode" INTEGER,
    "responseTime" INTEGER,
    "profundidade" INTEGER,
    "session_id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Requisito" (
    "id" SERIAL NOT NULL,
    "texto" TEXT NOT NULL,
    "textoAjuda" TEXT,
    "linkFixo" TEXT,
    "pontuacao" INTEGER NOT NULL,

    CONSTRAINT "Requisito_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Avaliacao" (
    "id" SERIAL NOT NULL,
    "urlSecretaria" TEXT NOT NULL,
    "nomeResponsavel" TEXT NOT NULL,
    "emailResponsavel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prazoRecurso" TIMESTAMP(3),
    "recursoExpirado" BOOLEAN NOT NULL DEFAULT false,
    "status" "public"."AvaliacaoStatus" NOT NULL DEFAULT 'PENDENTE_SECRETARIA',
    "ciclo" INTEGER NOT NULL DEFAULT 2025,
    "secretariaId" INTEGER NOT NULL,
    "pontuacaoFinal" DOUBLE PRECISION,
    "pontuacaoAutoavaliacao" DOUBLE PRECISION,
    "pontuacaoPrimeiraAnalise" DOUBLE PRECISION,
    "pontuacaoPosRecurso" DOUBLE PRECISION,
    "pontuacaoTotal" DOUBLE PRECISION,
    "dataFinalizacao" TIMESTAMP(3),

    CONSTRAINT "Avaliacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Resposta" (
    "id" SERIAL NOT NULL,
    "atende" BOOLEAN NOT NULL,
    "foiAutomatico" BOOLEAN NOT NULL DEFAULT false,
    "linkComprovante" TEXT,
    "linkComprovanteRecurso" TEXT,
    "comentarioAdmin" TEXT,
    "comentarioSecretaria" TEXT,
    "comentarioRecurso" TEXT,
    "comentarioAnaliseFinal" TEXT,
    "statusRecurso" TEXT,
    "statusValidacao" TEXT NOT NULL DEFAULT 'pendente',
    "statusValidacaoPosRecurso" TEXT,
    "recursoAtende" BOOLEAN,
    "analiseFinal" JSONB,
    "atendeOriginal" BOOLEAN,
    "requisitoId" INTEGER NOT NULL,
    "avaliacaoId" INTEGER NOT NULL,

    CONSTRAINT "Resposta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Secretaria" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "sigla" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "Secretaria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."User" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SECRETARIA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "secretariaId" INTEGER NOT NULL,
    "primeiroAcesso" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CodigoVerificacao" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "expiraEm" TIMESTAMP(3) NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CodigoVerificacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Evidencia" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'original',
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respostaId" INTEGER NOT NULL,

    CONSTRAINT "Evidencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LinkAnalista" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "respostaId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LinkAnalista_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LinkAnaliseFinal" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "respostaId" INTEGER NOT NULL,

    CONSTRAINT "LinkAnaliseFinal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Link_session_id_idx" ON "public"."Link"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "Link_url_session_id_key" ON "public"."Link"("url", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "Secretaria_nome_key" ON "public"."Secretaria"("nome");

-- CreateIndex
CREATE UNIQUE INDEX "Secretaria_sigla_key" ON "public"."Secretaria"("sigla");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE INDEX "CodigoVerificacao_email_tipo_idx" ON "public"."CodigoVerificacao"("email", "tipo");

-- CreateIndex
CREATE INDEX "LinkAnalista_respostaId_idx" ON "public"."LinkAnalista"("respostaId");

-- AddForeignKey
ALTER TABLE "public"."Link" ADD CONSTRAINT "Link_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."ScanSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Avaliacao" ADD CONSTRAINT "Avaliacao_secretariaId_fkey" FOREIGN KEY ("secretariaId") REFERENCES "public"."Secretaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Resposta" ADD CONSTRAINT "Resposta_requisitoId_fkey" FOREIGN KEY ("requisitoId") REFERENCES "public"."Requisito"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Resposta" ADD CONSTRAINT "Resposta_avaliacaoId_fkey" FOREIGN KEY ("avaliacaoId") REFERENCES "public"."Avaliacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."User" ADD CONSTRAINT "User_secretariaId_fkey" FOREIGN KEY ("secretariaId") REFERENCES "public"."Secretaria"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Evidencia" ADD CONSTRAINT "Evidencia_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "public"."Resposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LinkAnalista" ADD CONSTRAINT "LinkAnalista_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "public"."Resposta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LinkAnaliseFinal" ADD CONSTRAINT "LinkAnaliseFinal_respostaId_fkey" FOREIGN KEY ("respostaId") REFERENCES "public"."Resposta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
