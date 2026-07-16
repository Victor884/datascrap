
--PROFESSORES_HISTORICO

DECLARE @CODCOLIGADA            smallint = 1;
DECLARE @DATA_BASE              date     = '20260301';
-- altere aqui
DECLARE @COMPETENCIA            date     = EOMONTH(@DATA_BASE);
DECLARE @MES                    int      = MONTH(@COMPETENCIA);
DECLARE @ANO                    int      = YEAR(@COMPETENCIA);
DECLARE @PROXIMO_DIA_COMPETENCIA date   = DATEADD(day, 1, @COMPETENCIA);
DECLARE @DATA_BASE_MENOS_1_MES   date   = DATEADD(month, -1, @DATA_BASE);


-- Limpar sessão anterior
IF OBJECT_ID('tempdb..#PROFESSORES')     IS NOT NULL DROP TABLE #PROFESSORES;
IF OBJECT_ID('tempdb..#PROF_HIST_STAGE')      IS NOT NULL DROP TABLE #PROF_HIST_STAGE;


--    Candidatos via PFHSTSIT (situação "as of")
--    Situações que EXCLUEM o registro na competência:
--      D = Demitido (com DATADEMISSAO <= fim do mês anterior)
--      C = Cancelado
--      I = Inativo
--    Todas as demais entram (A, E, F, S, P, etc.)

;
WITH

  SIT_PERIODO
  AS
  (
    -- Última mudança de situação ANTES do próximo dia da competência
    SELECT
      PF.CODCOLIGADA
      , PF.CHAPA
      , CODSIT = COALESCE(HS.NOVASITUACAO, PF.CODSITUACAO)
      , PFUNC_FILIAL = PF.CODFILIAL
    FROM PFUNC PF WITH (NOLOCK)
    OUTER APPLY
    (
        SELECT TOP (1)
        HS.NOVASITUACAO
      FROM PFHSTSIT HS WITH (NOLOCK)
      WHERE HS.CODCOLIGADA = PF.CODCOLIGADA
        AND HS.CHAPA       = PF.CHAPA
        AND HS.DATAMUDANCA < @PROXIMO_DIA_COMPETENCIA
      ORDER BY HS.DATAMUDANCA DESC, HS.RECMODIFIEDON DESC, HS.RECCREATEDON DESC
    ) HS
    WHERE PF.CODCOLIGADA = @CODCOLIGADA
  ),
  --  Filial histórica "as of" via PFHSTSEC
  --    (evita pegar filial atual de quem transferiu)
  FILIAL_PERIODO
  AS
  (
    SELECT
      SEC.CODCOLIGADA
      , SEC.CHAPA
      -- PFHSTSEC guarda CODSECAO, CODFILIAL via PFSETOR
      , CODFILIAL_PERIODO = COALESCE(ST.CODFILIAL, SEC.CODFILIAL)
    FROM PFUNC SEC WITH (NOLOCK)
    OUTER APPLY
    (
        -- Última mudança de seção antes do próximo dia da competência
        SELECT TOP (1)
        HSC.CODSECAO
      FROM PFHSTSEC HSC WITH (NOLOCK)
      WHERE HSC.CODCOLIGADA = SEC.CODCOLIGADA
        AND HSC.CHAPA       = SEC.CHAPA
        AND HSC.DTMUDANCA   < @PROXIMO_DIA_COMPETENCIA
      ORDER BY HSC.DTMUDANCA DESC, HSC.RECMODIFIEDON DESC, HSC.RECCREATEDON DESC
    ) HSC
      LEFT JOIN PSECAO ST WITH (NOLOCK)
      ON ST.CODCOLIGADA = SEC.CODCOLIGADA
        AND ST.CODIGO      = HSC.CODSECAO
    WHERE SEC.CODCOLIGADA = @CODCOLIGADA
  ),

  --  Critério A — tinha situação ativa/afastada na competência
  --  (admitido antes do fim do mês e não demitido antes do início)
  CRIT_SITUACAO
  AS
  (
    SELECT SP.CHAPA
    FROM SIT_PERIODO SP
      JOIN PFUNC PF WITH (NOLOCK)
      ON PF.CODCOLIGADA = @CODCOLIGADA
        AND PF.CHAPA       = SP.CHAPA
    WHERE ISNULL(SP.CODSIT, '') NOT IN ('D', 'C', 'I')
      -- Admitido até o último dia da competência
      AND PF.DATAADMISSAO <= @COMPETENCIA
      -- Se demitido, a demissão deve ser a partir do 1o dia da competência
      AND (PF.DATADEMISSAO IS NULL OR PF.DATADEMISSAO >= @DATA_BASE)
  ),

  -- Critério B — tinha financeiro de salário composto no mês
  --    (captura demitidos com rescisão processada no mês)
  CRIT_FINANCEIRO
  AS
  (
    SELECT DISTINCT PS.CHAPA
    FROM PFFINANC PS WITH (NOLOCK)
      JOIN
      (
        -- Lista de eventos de salário composto (espelho de EVENTOS_SALARIO_COMPOSTO)
        SELECT V.CODEVENTO
      FROM (VALUES
          ('0001'),
          ('0002'),
          ('0003'),
          ('0004'),
          ('0005'),
          ('0006'),
          ('0007'),
          ('0008'),
          ('0009'),
          ('0010'),
          ('0011'),
          ('0012'),
          ('0013'),
          ('0014'),
          ('0015'),
          ('0016'),
          ('0017'),
          ('0018'),
          ('0019'),
          ('0020'),
          ('0021'),
          ('0022'),
          ('0023'),
          ('0024'),
          ('0025'),
          ('0026'),
          ('0027'),
          ('0028'),
          ('0029'),
          ('0030'),
          ('0047'),
          ('0048'),
          ('0057'),
          ('0059'),
          ('0110'),
          ('0111'),
          ('0200'),
          ('0201'),
          ('0202'),
          ('0203'),
          ('0204'),
          ('0205'),
          ('0206'),
          ('0207'),
          ('0208'),
          ('0209'),
          ('0210'),
          ('0211'),
          ('0212'),
          ('0213'),
          ('0214'),
          ('0215'),
          ('0216'),
          ('0217'),
          ('0218'),
          ('0219'),
          ('0220'),
          ('0221'),
          ('0222'),
          ('0223'),
          ('0224'),
          ('0225'),
          ('0226'),
          ('1215'),
          ('1216'),
          ('1217'),
          ('1237')
        ) V(CODEVENTO)
    ) E ON E.CODEVENTO = PS.CODEVENTO
    WHERE PS.CODCOLIGADA = @CODCOLIGADA
      AND PS.MESCOMP     = @MES
      AND PS.ANOCOMP     = @ANO
      AND PS.NROPERIODO  IN (10, 40)
  ),

  -- Critério C — tem composição (PFSALCMP) 
  -- cobre histórico sem financeiro atual que a planilha inclui
  CRIT_COMPOSICAO
  AS
  (
    SELECT DISTINCT SC.CHAPA
    FROM PFSALCMP SC WITH (NOLOCK)
      JOIN PFUNC PF WITH (NOLOCK)
      ON PF.CODCOLIGADA = SC.CODCOLIGADA
        AND PF.CHAPA = SC.CHAPA
    WHERE SC.CODCOLIGADA    = @CODCOLIGADA
      AND SC.RECCREATEDON   < @PROXIMO_DIA_COMPETENCIA
      AND PF.DATAADMISSAO <= @COMPETENCIA
      -- Tem folha posterior à competência (evento ainda em uso)
      AND EXISTS
      (
          SELECT 1
      FROM PFFINANC PS_POST WITH (NOLOCK)
      WHERE PS_POST.CODCOLIGADA = SC.CODCOLIGADA
        AND PS_POST.CHAPA       = SC.CHAPA
        AND PS_POST.CODEVENTO   = SC.CODEVENTO
        AND (PS_POST.ANOCOMP > @ANO
        OR (PS_POST.ANOCOMP = @ANO AND PS_POST.MESCOMP > @MES))
      )
  ),
  --  União dos critérios → candidatos únicos
  CANDIDATOS
  AS
  (
              SELECT CHAPA
      FROM CRIT_SITUACAO
    UNION
      SELECT CHAPA
      FROM CRIT_FINANCEIRO
    UNION
      SELECT CHAPA
      FROM CRIT_COMPOSICAO
  ),
  -- dados cadastrais históricos
  DADOS
  AS
  (
    SELECT
      CODFILIAL   = CAST(COALESCE(FP.CODFILIAL_PERIODO, PF.CODFILIAL) AS smallint)
      , NOMEFANTASIA = CAST(ISNULL(GF.NOMEFANTASIA, '') AS varchar(100))
      , CIDADE       = CAST(ISNULL(GF.CIDADE,       '') AS varchar(32))
      , ESTADO       = CAST(ISNULL(GF.ESTADO,       '') AS varchar(2))
      , CHAPA        = CAST(PF.CHAPA                    AS varchar(16))
      , NOME         = CAST(PF.NOME                     AS varchar(120))
      -- Situação legível: traduz código RM para o texto que a planilha usaria
      , SITUACAO     = CAST(
            CASE ISNULL(SP.CODSIT, 'A')
                WHEN 'A' THEN 'ATIVO'
                WHEN 'E' THEN 'AF.PREVIDÊNCIA'
                WHEN 'F' THEN 'FÉRIAS'
                WHEN 'S' THEN 'CONTRATO DE TRABALHO SUSPENSO'
                WHEN 'P' THEN 'AVISO PRÉVIO'
                WHEN 'V' THEN 'AVISO PRÉVIO'
                WHEN 'L' THEN 'LICENÇA S/VENC'
                WHEN 'R' THEN 'LICENÇA MATER.'
                WHEN 'T' THEN 'AF.AC.TRABALHO'
                WHEN 'G' THEN 'LICENÇA S/VENC'
                WHEN 'D' THEN 'DEMITIDO'
                WHEN 'I' THEN 'INATIVO'
                WHEN 'C' THEN 'CANCELADO'
                ELSE UPPER(ISNULL(SP.CODSIT, 'ATIVO'))
            END AS varchar(50))
      , COMPETENCIA  = @COMPETENCIA
    FROM CANDIDATOS C
      JOIN PFUNC PF WITH (NOLOCK)
      ON PF.CODCOLIGADA = @CODCOLIGADA
        AND PF.CHAPA       = C.CHAPA
      LEFT JOIN SIT_PERIODO SP
      ON SP.CHAPA = C.CHAPA
      LEFT JOIN FILIAL_PERIODO FP
      ON FP.CHAPA = C.CHAPA
      -- Dados da filial (nome, cidade, estado) via GFILIAL ou PFFILIAL
      LEFT JOIN GFILIAL GF WITH (NOLOCK)
      ON GF.CODCOLIGADA = @CODCOLIGADA
        AND GF.CODFILIAL   = COALESCE(FP.CODFILIAL_PERIODO, PF.CODFILIAL)
  )
-- Gravar na temp com mesmo schema que #PROFESSORES
SELECT
  CODFILIAL
  , FILIAL       = NOMEFANTASIA
  , CIDADE
  , ESTADO
  , MATRICULA    = CHAPA
  , COLABORADOR  = NOME
  , SITUACAO
  , COMPETENCIA
INTO #PROFESSORES
FROM DADOS
-- Excluir "Admissão prox.mês"
WHERE SITUACAO <> 'ADMISSAO PROX.MES'
ORDER BY CODFILIAL, MATRICULA;
/*
SELECT
    'TOTAL_CANDIDATOS'       AS METRICA, COUNT(*)  AS QTD FROM #PROFESSORES
UNION ALL SELECT 'CRIT_A_SITUACAO',     COUNT(DISTINCT CHAPA) FROM CRIT_SITUACAO     -- CTEs acima fora de escopo aqui
;

-- Distribuição de situações geradas
SELECT SITUACAO, COUNT(*) AS QTD
FROM #PROFESSORES
GROUP BY SITUACAO
ORDER BY QTD DESC;

-- Comparar com planilha do mês equivalente (quando disponível):
-- SELECT COUNT(*) FROM #PROFESSORES
*/

WITH
  PROFESSORES
  AS
  (
    SELECT DISTINCT
      CODFILIAL    = CAST(P.CODFILIAL AS smallint)
    , NOMEFANTASIA = CAST(P.FILIAL AS varchar(100))
    , CIDADE       = CAST(P.CIDADE AS varchar(32))
    , ESTADO       = CAST(P.ESTADO AS varchar(2))
    , CHAPA        = CAST(P.MATRICULA AS varchar(16))
    , NOME         = CAST(P.COLABORADOR AS varchar(120))
    , SITUACAO     = CAST(P.SITUACAO AS varchar(50))
    , COMPETENCIA  = CAST(P.COMPETENCIA AS date)
    FROM #PROFESSORES P
    WHERE CAST(P.COMPETENCIA AS date) = @COMPETENCIA
      AND UPPER(LTRIM(RTRIM(ISNULL(P.SITUACAO, '')))) COLLATE SQL_Latin1_General_CP1_CI_AI <> 'ADMISSAO PROX.MES'
  ),
  EVENTOS_SALARIO_COMPOSTO
  AS
  (
    SELECT V.CODEVENTO
    FROM (VALUES
        ('0001'),
        ('0002'),
        ('0003'),
        ('0004'),
        ('0005'),
        ('0006'),
        ('0007'),
        ('0008'),
        ('0009'),
        ('0010'),
        ('0011'),
        ('0012'),
        ('0013'),
        ('0014'),
        ('0015'),
        ('0016'),
        ('0017'),
        ('0018'),
        ('0019'),
        ('0020'),
        ('0021'),
        ('0022'),
        ('0023'),
        ('0024'),
        ('0025'),
        ('0026'),
        ('0027'),
        ('0028'),
        ('0029'),
        ('0030'),
        ('0047'),
        ('0048'),
        ('0057'),
        ('0059'),
        ('0110'),
        ('0111'),
        ('0200'),
        ('0201'),
        ('0202'),
        ('0203'),
        ('0204'),
        ('0205'),
        ('0206'),
        ('0207'),
        ('0208'),
        ('0209'),
        ('0210'),
        ('0211'),
        ('0212'),
        ('0213'),
        ('0214'),
        ('0215'),
        ('0216'),
        ('0217'),
        ('0218'),
        ('0219'),
        ('0220'),
        ('0221'),
        ('0222'),
        ('0223'),
        ('0224'),
        ('0225'),
        ('0226'),
        ('1215'),
        ('1216'),
        ('1217'),
        ('1230'),
        ('1231'),
        ('1232'),
        ('1233'),
        ('1237')
    ) V(CODEVENTO)
  ),
  SITUACAO_PERIODO
  AS
  (
    SELECT
      P.CHAPA
    , CODSIT_PERIODO = COALESCE(HS.NOVASITUACAO, PF.CODSITUACAO)
    FROM PROFESSORES P
      LEFT JOIN PFUNC PF WITH (NOLOCK)
      ON PF.CODCOLIGADA = @CODCOLIGADA
        AND PF.CHAPA = P.CHAPA
    OUTER APPLY
    (
      SELECT TOP (1)
        HS.NOVASITUACAO
      FROM PFHSTSIT HS WITH (NOLOCK)
      WHERE HS.CODCOLIGADA = @CODCOLIGADA
        AND HS.CHAPA = P.CHAPA
        AND HS.DATAMUDANCA < @PROXIMO_DIA_COMPETENCIA
      ORDER BY HS.DATAMUDANCA DESC, HS.RECMODIFIEDON DESC, HS.RECCREATEDON DESC
    ) HS
  ),
  HIST_SALARIO
  AS
  (
    SELECT
      H.CODCOLIGADA
    , H.CHAPA
    , H.CODEVENTO
    , H.NROSALARIO
    , H.DTMUDANCA
    , H.SALARIO
    , H.JORNADA
    , H.RECCREATEDON
    , H.RECMODIFIEDON
    , RN_EVENTO = ROW_NUMBER() OVER
        (
          PARTITION BY H.CODCOLIGADA, H.CHAPA, H.CODEVENTO
          ORDER BY H.DTMUDANCA DESC, H.RECMODIFIEDON DESC, H.RECCREATEDON DESC
        )
    , RN_SALARIO = ROW_NUMBER() OVER
        (
          PARTITION BY H.CODCOLIGADA, H.CHAPA, H.CODEVENTO, H.NROSALARIO
          ORDER BY H.DTMUDANCA DESC, H.RECMODIFIEDON DESC, H.RECCREATEDON DESC
        )
    FROM PFHSTSAL H WITH (NOLOCK)
      JOIN EVENTOS_SALARIO_COMPOSTO E
      ON E.CODEVENTO = H.CODEVENTO
    WHERE H.CODCOLIGADA = @CODCOLIGADA
      AND H.DTMUDANCA < @PROXIMO_DIA_COMPETENCIA
  ),
  HIST_ULTIMO_EVENTO
  AS
  (
    SELECT *
    FROM HIST_SALARIO
    WHERE RN_EVENTO = 1
  ),
  HIST_ULTIMO_SALARIO
  AS
  (
    SELECT *
    FROM HIST_SALARIO
    WHERE RN_SALARIO = 1
  ),
  FINANCEIRO_BASE
  AS
  (
    SELECT
      P.CODFILIAL
    , P.NOMEFANTASIA
    , P.CIDADE
    , P.ESTADO
    , P.CHAPA
    , P.NOME
    , P.SITUACAO
    , CODEVENTO = PS.CODEVENTO
    , DTMUDANCA = CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND PS.CODEVENTO IN ('1215','1216','1217','1237')
        AND ISNULL(AR_FIN.JORNADA, 0) > 0
            THEN AR_FIN.RECMODIFIEDON
          ELSE H.DTMUDANCA
        END
    , SALARIO   = CAST(
        CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND H.CHAPA IS NOT NULL
        AND SC_FIN.RECMODIFIEDON IS NULL
        AND ISNULL(PS.REF, 0) * 60 > ISNULL(H.JORNADA, 0) THEN COALESCE(PS.VALORORIGINAL, PS.VALOR)
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND H.CHAPA IS NOT NULL
        AND SC_FIN.RECMODIFIEDON > H.RECMODIFIEDON
        AND ISNULL(SC_FIN.VALOR, 0) > 0
        AND ISNULL(SC_FIN.JORNADA, 0) > 0
        AND ABS(CAST(SC_FIN.VALOR AS decimal(18, 4)) - CAST(COALESCE(PS.VALORORIGINAL, PS.VALOR) AS decimal(18, 4))) < 0.005
        AND ABS(CAST(SC_FIN.JORNADA AS decimal(18, 4)) - CAST(ISNULL(PS.REF, 0) * 60 AS decimal(18, 4))) < 0.005 THEN SC_FIN.VALOR
          WHEN H.CHAPA IS NOT NULL THEN H.SALARIO
          ELSE COALESCE(PS.VALORORIGINAL, PS.VALOR)
        END AS money)
    , JORNADA   = CAST(
        CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND H.CHAPA IS NOT NULL
        AND SC_FIN.RECMODIFIEDON IS NULL
        AND ISNULL(PS.REF, 0) * 60 > ISNULL(H.JORNADA, 0) THEN PS.REF * 60
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND H.CHAPA IS NOT NULL
        AND SC_FIN.RECMODIFIEDON > H.RECMODIFIEDON
        AND ISNULL(SC_FIN.VALOR, 0) > 0
        AND ISNULL(SC_FIN.JORNADA, 0) > 0
        AND ABS(CAST(SC_FIN.VALOR AS decimal(18, 4)) - CAST(COALESCE(PS.VALORORIGINAL, PS.VALOR) AS decimal(18, 4))) < 0.005
        AND ABS(CAST(SC_FIN.JORNADA AS decimal(18, 4)) - CAST(ISNULL(PS.REF, 0) * 60 AS decimal(18, 4))) < 0.005 THEN SC_FIN.JORNADA
          WHEN H.CHAPA IS NOT NULL THEN H.JORNADA
          WHEN ISNULL(PS.REF, 0) > 0 THEN PS.REF * 60
          WHEN ISNULL(PS.HORA, 0) > 0 THEN PS.HORA
          WHEN PS.CODEVENTO IN ('1215','1216','1217','1237') AND ISNULL(AR_FIN.JORNADA, 0) > 0 THEN AR_FIN.JORNADA
          ELSE NULL
        END AS numeric(15, 4))
    , FONTE     = CAST('FINANCEIRO' AS varchar(20))
    , PRIORIDADE = 1
    , RN = ROW_NUMBER() OVER
        (
          PARTITION BY P.CODFILIAL, P.CHAPA, PS.CODEVENTO
          ORDER BY
            CASE WHEN PS.NROPERIODO = 40 THEN 0 WHEN PS.NROPERIODO = 10 THEN 1 ELSE 2 END,
            H.DTMUDANCA DESC,
            PS.RECMODIFIEDON DESC,
            PS.RECCREATEDON DESC
        )
    FROM PROFESSORES P
      JOIN PFFINANC PS WITH (NOLOCK)
      ON PS.CODCOLIGADA = @CODCOLIGADA
        AND PS.CHAPA = P.CHAPA
        AND PS.MESCOMP = @MES
        AND PS.ANOCOMP = @ANO
        AND PS.NROPERIODO IN (10, 40)
      JOIN EVENTOS_SALARIO_COMPOSTO E
      ON E.CODEVENTO = PS.CODEVENTO
      LEFT JOIN HIST_ULTIMO_EVENTO H
      ON H.CODCOLIGADA = PS.CODCOLIGADA
        AND H.CHAPA = PS.CHAPA
        AND H.CODEVENTO = PS.CODEVENTO
    OUTER APPLY
    (
      SELECT TOP (1)
        SC.VALOR
           , SC.JORNADA
           , SC.RECMODIFIEDON
      FROM PFSALCMP SC WITH (NOLOCK)
      WHERE SC.CODCOLIGADA = PS.CODCOLIGADA
        AND SC.CHAPA = PS.CHAPA
        AND SC.CODEVENTO = PS.CODEVENTO
        AND SC.NROSALARIO = H.NROSALARIO
      ORDER BY SC.RECMODIFIEDON DESC, SC.RECCREATEDON DESC
    ) SC_FIN
    OUTER APPLY
    (
      SELECT TOP (1)
        AR.JORNADA
           , AR.RECMODIFIEDON
      FROM PFATIVREMUNERADA AR WITH (NOLOCK)
      WHERE AR.CODCOLIGADA = PS.CODCOLIGADA
        AND AR.CHAPA = PS.CHAPA
        AND AR.CODEVENTO = PS.CODEVENTO
        AND AR.RECMODIFIEDON < @PROXIMO_DIA_COMPETENCIA
      ORDER BY AR.RECMODIFIEDON DESC, AR.RECCREATEDON DESC
    ) AR_FIN
      LEFT JOIN SITUACAO_PERIODO SP
      ON SP.CHAPA = P.CHAPA
    WHERE ISNULL(SP.CODSIT_PERIODO, '') NOT IN ('C', 'I')
      AND
      (
        H.CHAPA IS NULL
      OR
      (
          ISNULL(H.SALARIO, 0) > 0
      AND ISNULL(H.JORNADA, 0) > 0
        )
      )
  ),
  FINANCEIRO
  AS
  (
    SELECT
      CODFILIAL, NOMEFANTASIA, CIDADE, ESTADO, CHAPA, NOME, SITUACAO,
      CODEVENTO, DTMUDANCA, SALARIO, JORNADA, FONTE, PRIORIDADE
    FROM FINANCEIRO_BASE
    WHERE RN = 1
  ),
  ATIVIDADE_REMUNERADA
  AS
  (
    SELECT
      P.CODFILIAL
    , P.NOMEFANTASIA
    , P.CIDADE
    , P.ESTADO
    , P.CHAPA
    , P.NOME
    , P.SITUACAO
    , CODEVENTO = AR.CODEVENTO
    , DTMUDANCA = AR.RECMODIFIEDON
    , SALARIO   = CAST(AR.VALOR AS money)
    , JORNADA   = CAST(AR.JORNADA AS numeric(15, 4))
    , FONTE     = CAST('ATIVIDADE' AS varchar(20))
    , PRIORIDADE = 2
    FROM PROFESSORES P
      JOIN PFATIVREMUNERADA AR WITH (NOLOCK)
      ON AR.CODCOLIGADA = @CODCOLIGADA
        AND AR.CHAPA = P.CHAPA
        AND AR.RECMODIFIEDON < @PROXIMO_DIA_COMPETENCIA
      JOIN EVENTOS_SALARIO_COMPOSTO E
      ON E.CODEVENTO = AR.CODEVENTO
      LEFT JOIN SITUACAO_PERIODO SP
      ON SP.CHAPA = P.CHAPA
    WHERE ISNULL(SP.CODSIT_PERIODO, '') NOT IN ('C', 'I')
      AND NOT EXISTS
      (
        SELECT 1
      FROM FINANCEIRO F
      WHERE F.CHAPA = AR.CHAPA
        AND F.CODEVENTO = AR.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM PFFINANC PS_ANY WITH (NOLOCK)
      WHERE PS_ANY.CODCOLIGADA = AR.CODCOLIGADA
        AND PS_ANY.CHAPA = AR.CHAPA
        AND PS_ANY.CODEVENTO = AR.CODEVENTO
        AND PS_ANY.ANOCOMP = @ANO
        AND PS_ANY.MESCOMP = @MES
      )
  ),
  HISTORICO_COMPOSICAO_BASE
  AS
  (
    SELECT
      P.CODFILIAL
    , P.NOMEFANTASIA
    , P.CIDADE
    , P.ESTADO
    , P.CHAPA
    , P.NOME
    , P.SITUACAO
    , CODEVENTO = H.CODEVENTO
    , DTMUDANCA = H.DTMUDANCA
    , SALARIO   = CAST(
        CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112) THEN SC.VALOR
          ELSE H.SALARIO
        END AS money)
    , JORNADA   = CAST(
        CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112) THEN SC.JORNADA
          ELSE H.JORNADA
        END AS numeric(15, 4))
    , FONTE     = CAST('HISTORICO' AS varchar(20))
    , PRIORIDADE = 3
    , RN = ROW_NUMBER() OVER
        (
          PARTITION BY H.CHAPA, H.CODEVENTO, H.NROSALARIO
          ORDER BY H.DTMUDANCA DESC, H.RECMODIFIEDON DESC, H.RECCREATEDON DESC
        )
    FROM PROFESSORES P
      JOIN HIST_ULTIMO_SALARIO H
      ON H.CODCOLIGADA = @CODCOLIGADA
        AND H.CHAPA = P.CHAPA
      JOIN PFSALCMP SC WITH (NOLOCK)
      ON SC.CODCOLIGADA = H.CODCOLIGADA
        AND SC.CHAPA = H.CHAPA
        AND SC.CODEVENTO = H.CODEVENTO
        AND SC.NROSALARIO = H.NROSALARIO
        AND SC.RECCREATEDON < @PROXIMO_DIA_COMPETENCIA
      LEFT JOIN SITUACAO_PERIODO SP
      ON SP.CHAPA = P.CHAPA
    WHERE ISNULL(SP.CODSIT_PERIODO, '') NOT IN ('C', 'I')
      AND ISNULL(H.SALARIO, 0) > 0
      AND ISNULL(H.JORNADA, 0) > 0
      AND NOT EXISTS
      (
        SELECT 1
      FROM FINANCEIRO F
      WHERE F.CHAPA = H.CHAPA
        AND F.CODEVENTO = H.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM ATIVIDADE_REMUNERADA A
      WHERE A.CHAPA = H.CHAPA
        AND A.CODEVENTO = H.CODEVENTO
      )
      AND
      (
        EXISTS
      (
        SELECT 1
      FROM PFFINANC PS_POST WITH (NOLOCK)
      WHERE PS_POST.CODCOLIGADA = H.CODCOLIGADA
        AND PS_POST.CHAPA = H.CHAPA
        AND PS_POST.CODEVENTO = H.CODEVENTO
        AND
        (
            PS_POST.ANOCOMP > @ANO
        OR (PS_POST.ANOCOMP = @ANO AND PS_POST.MESCOMP > @MES)
          )
      )
      OR
      (
        ISNULL(SP.CODSIT_PERIODO, '') = 'P'
      AND EXISTS
      (
        SELECT 1
      FROM PFUNC PF_DEM WITH (NOLOCK)
      WHERE PF_DEM.CODCOLIGADA = H.CODCOLIGADA
        AND PF_DEM.CHAPA       = H.CHAPA
        AND PF_DEM.DATADEMISSAO IS NOT NULL
        AND PF_DEM.DATADEMISSAO > @COMPETENCIA
      )
      )
      )
  ),
  HISTORICO_COMPOSICAO
  AS
  (
    SELECT
      CODFILIAL, NOMEFANTASIA, CIDADE, ESTADO, CHAPA, NOME, SITUACAO,
      CODEVENTO, DTMUDANCA, SALARIO, JORNADA, FONTE, PRIORIDADE
    FROM HISTORICO_COMPOSICAO_BASE
    WHERE RN = 1
  ),
  HISTORICO_SEM_COMPOSICAO_BASE
  AS
  (
    SELECT
      P.CODFILIAL
    , P.NOMEFANTASIA
    , P.CIDADE
    , P.ESTADO
    , P.CHAPA
    , P.NOME
    , P.SITUACAO
    , CODEVENTO = H.CODEVENTO
    , DTMUDANCA = H.DTMUDANCA
    , SALARIO   = CAST(H.SALARIO AS money)
    , JORNADA   = CAST(H.JORNADA AS numeric(15, 4))
    , FONTE     = CAST('HIST_SEM_CMP' AS varchar(20))
    , PRIORIDADE = 4
    , RN = ROW_NUMBER() OVER
        (
          PARTITION BY H.CHAPA, H.CODEVENTO, H.NROSALARIO
          ORDER BY H.DTMUDANCA DESC, H.RECMODIFIEDON DESC, H.RECCREATEDON DESC
        )
    , TEM_FOLHA_ANTERIOR = CASE
        WHEN EXISTS
        (
          SELECT 1
      FROM PFFINANC PS WITH (NOLOCK)
      WHERE PS.CODCOLIGADA = H.CODCOLIGADA
        AND PS.CHAPA = H.CHAPA
        AND PS.CODEVENTO = H.CODEVENTO
        AND
        (
              PS.ANOCOMP < @ANO
        OR (PS.ANOCOMP = @ANO AND PS.MESCOMP < @MES)
            )
        ) THEN 1 ELSE 0 END
    , TEM_FOLHA_POSTERIOR = CASE
        WHEN EXISTS
        (
          SELECT 1
      FROM PFFINANC PS WITH (NOLOCK)
      WHERE PS.CODCOLIGADA = H.CODCOLIGADA
        AND PS.CHAPA = H.CHAPA
        AND PS.CODEVENTO = H.CODEVENTO
        AND
        (
              PS.ANOCOMP > @ANO
        OR (PS.ANOCOMP = @ANO AND PS.MESCOMP > @MES)
            )
        ) THEN 1 ELSE 0 END
    , SIT_HIST = SP.CODSIT_PERIODO
    FROM PROFESSORES P
      JOIN HIST_ULTIMO_SALARIO H
      ON H.CODCOLIGADA = @CODCOLIGADA
        AND H.CHAPA = P.CHAPA
      LEFT JOIN SITUACAO_PERIODO SP
      ON SP.CHAPA = P.CHAPA
    WHERE ISNULL(SP.CODSIT_PERIODO, '') NOT IN ('C', 'I')
      AND ISNULL(H.SALARIO, 0) > 0
      AND ISNULL(H.JORNADA, 0) > 0
      AND NOT EXISTS
      (
        SELECT 1
      FROM PFSALCMP SC WITH (NOLOCK)
      WHERE SC.CODCOLIGADA = H.CODCOLIGADA
        AND SC.CHAPA = H.CHAPA
        AND SC.CODEVENTO = H.CODEVENTO
        AND SC.NROSALARIO = H.NROSALARIO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM FINANCEIRO F
      WHERE F.CHAPA = H.CHAPA
        AND F.CODEVENTO = H.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM ATIVIDADE_REMUNERADA A
      WHERE A.CHAPA = H.CHAPA
        AND A.CODEVENTO = H.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM HISTORICO_COMPOSICAO HC
      WHERE HC.CHAPA = H.CHAPA
        AND HC.CODEVENTO = H.CODEVENTO
      )
  ),
  HISTORICO_SEM_COMPOSICAO
  AS
  (
    SELECT
      CODFILIAL, NOMEFANTASIA, CIDADE, ESTADO, CHAPA, NOME, SITUACAO,
      CODEVENTO, DTMUDANCA, SALARIO, JORNADA, FONTE, PRIORIDADE
    FROM HISTORICO_SEM_COMPOSICAO_BASE
    WHERE RN = 1
      AND
      (
        (
          SIT_HIST = 'F'
      AND
      (
            TEM_FOLHA_POSTERIOR = 1
      OR CAST(DTMUDANCA AS date) >= @DATA_BASE
          )
        )
      OR
      (
          SIT_HIST = 'E'
      AND
      (
            TEM_FOLHA_ANTERIOR = 1
      OR CAST(DTMUDANCA AS date) >= @DATA_BASE_MENOS_1_MES
          )
        )
      OR
      (
          ISNULL(SIT_HIST, 'A') = 'A'
      AND CODEVENTO = '0057'
      AND TEM_FOLHA_POSTERIOR = 1
        )
      OR
      (
          ISNULL(SIT_HIST, 'A') = 'A'
      AND TEM_FOLHA_ANTERIOR = 0
      AND CODEVENTO = '0111'
      AND CAST(DTMUDANCA AS date) >= @DATA_BASE_MENOS_1_MES
        )
      )
  ),
  COMPOSICAO_SEM_HISTORICO
  AS
  (
    SELECT
      P.CODFILIAL
    , P.NOMEFANTASIA
    , P.CIDADE
    , P.ESTADO
    , P.CHAPA
    , P.NOME
    , P.SITUACAO
    , CODEVENTO = SC.CODEVENTO
    , DTMUDANCA = HSC.DTMUDANCA
    , SALARIO   = CAST(
        CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND ISNULL(PS_CMP.REF, 0) > 0 THEN COALESCE(PS_CMP.VALORORIGINAL, PS_CMP.VALOR)
          ELSE SC.VALOR
        END AS money)
    , JORNADA   = CAST(
        CASE
          WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
        AND ISNULL(PS_CMP.REF, 0) > 0 THEN PS_CMP.REF * 60
          ELSE SC.JORNADA
        END AS numeric(15, 4))
    , FONTE     = CAST('PFSALCMP' AS varchar(20))
    , PRIORIDADE = 5
    FROM PROFESSORES P
      JOIN PFSALCMP SC WITH (NOLOCK)
      ON SC.CODCOLIGADA = @CODCOLIGADA
        AND SC.CHAPA = P.CHAPA
        AND SC.RECCREATEDON < @PROXIMO_DIA_COMPETENCIA
      JOIN EVENTOS_SALARIO_COMPOSTO E
      ON E.CODEVENTO = SC.CODEVENTO
    OUTER APPLY
    (
      SELECT TOP (1)
        HSC.DTMUDANCA
      FROM PFHSTSAL HSC WITH (NOLOCK)
      WHERE HSC.CODCOLIGADA = SC.CODCOLIGADA
        AND HSC.CHAPA = SC.CHAPA
        AND HSC.CODEVENTO = SC.CODEVENTO
        AND HSC.NROSALARIO = SC.NROSALARIO
        AND HSC.DTMUDANCA < @PROXIMO_DIA_COMPETENCIA
      ORDER BY HSC.DTMUDANCA DESC, HSC.RECMODIFIEDON DESC, HSC.RECCREATEDON DESC
    ) HSC
    OUTER APPLY
    (
      SELECT TOP (1)
        PS_CMP.REF
           , PS_CMP.VALOR
           , PS_CMP.VALORORIGINAL
      FROM PFFINANC PS_CMP WITH (NOLOCK)
      WHERE PS_CMP.CODCOLIGADA = SC.CODCOLIGADA
        AND PS_CMP.CHAPA = SC.CHAPA
        AND PS_CMP.CODEVENTO = SC.CODEVENTO
        AND PS_CMP.MESCOMP = @MES
        AND PS_CMP.ANOCOMP = @ANO
        AND PS_CMP.NROPERIODO IN (10, 40)
      ORDER BY CASE WHEN PS_CMP.NROPERIODO = 40 THEN 0 WHEN PS_CMP.NROPERIODO = 10 THEN 1 ELSE 2 END,
               PS_CMP.RECMODIFIEDON DESC,
               PS_CMP.RECCREATEDON DESC
    ) PS_CMP
      LEFT JOIN SITUACAO_PERIODO SP
      ON SP.CHAPA = P.CHAPA
    WHERE ISNULL(SP.CODSIT_PERIODO, '') NOT IN ('C', 'I')
      AND ISNULL(SC.VALOR, 0) > 0
      AND ISNULL(SC.JORNADA, 0) > 0
      AND NOT EXISTS
      (
        SELECT 1
      FROM FINANCEIRO F
      WHERE F.CHAPA = SC.CHAPA
        AND F.CODEVENTO = SC.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM ATIVIDADE_REMUNERADA A
      WHERE A.CHAPA = SC.CHAPA
        AND A.CODEVENTO = SC.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM HISTORICO_COMPOSICAO H
      WHERE H.CHAPA = SC.CHAPA
        AND H.CODEVENTO = SC.CODEVENTO
      )
      AND NOT EXISTS
      (
        SELECT 1
      FROM HISTORICO_SEM_COMPOSICAO H
      WHERE H.CHAPA = SC.CHAPA
        AND H.CODEVENTO = SC.CODEVENTO
      )
      AND EXISTS
      (
        SELECT 1
      FROM PFFINANC PS_POST WITH (NOLOCK)
      WHERE PS_POST.CODCOLIGADA = SC.CODCOLIGADA
        AND PS_POST.CHAPA = SC.CHAPA
        AND PS_POST.CODEVENTO = SC.CODEVENTO
        AND
        (
            PS_POST.ANOCOMP > @ANO
        OR (PS_POST.ANOCOMP = @ANO AND PS_POST.MESCOMP > @MES)
          )
      )
  ),
  UNIFICADO
  AS
  (
                      SELECT *
      FROM FINANCEIRO
    UNION ALL
      SELECT *
      FROM ATIVIDADE_REMUNERADA
    UNION ALL
      SELECT *
      FROM HISTORICO_COMPOSICAO
    UNION ALL
      SELECT *
      FROM HISTORICO_SEM_COMPOSICAO
    UNION ALL
      SELECT *
      FROM COMPOSICAO_SEM_HISTORICO
  ),
  DEDUP
  AS
  (
    SELECT
      U.*
    , RN = ROW_NUMBER() OVER
        (
          PARTITION BY U.CODFILIAL, U.CHAPA, U.CODEVENTO
          ORDER BY
            U.PRIORIDADE,
            CASE WHEN U.DTMUDANCA IS NULL THEN 1 ELSE 0 END,
            U.DTMUDANCA DESC
        )
    FROM UNIFICADO U
  )
SELECT
  CODFILIAL       = CAST(D.CODFILIAL AS smallint)
, NOMEFANTASIA    = D.NOMEFANTASIA
, CIDADE          = D.CIDADE
, ESTADO          = D.ESTADO
, CHAPA           = D.CHAPA
, NOME            = D.NOME
, SITUACAO        = UPPER(LTRIM(RTRIM(ISNULL(D.SITUACAO, ''))))
, CODEVENTO       = D.CODEVENTO
, DESCRICAO       = PE.DESCRICAO
, JORNADA_SEMANAL = CASE
                      WHEN D.FONTE = 'ATIVIDADE' THEN '-'
                      WHEN D.FONTE = 'FINANCEIRO' AND D.CODEVENTO IN ('1215','1216','1217','1237') AND CAST(D.JORNADA AS numeric(15, 4)) = 240 THEN '0,00'
                      WHEN ISNULL(D.JORNADA, 0) > 0 THEN REPLACE(CAST(CAST(D.JORNADA / 4.5 / 60.0 AS decimal(10, 2)) AS varchar(20)), '.', ',')
                      ELSE '-'
                    END
, VALOR_HORA      = CAST(
                      CASE
                        WHEN ISNULL(D.JORNADA, 0) > 0 THEN D.SALARIO / (D.JORNADA / 60.0)
                        ELSE D.SALARIO
                      END
                    AS decimal(10, 2))
, VALOR_MENSAL    = CAST(D.SALARIO AS money)
, JORNADA_MENSAL  = CASE
                      WHEN ISNULL(D.JORNADA, 0) > 0 THEN REPLACE(CAST(CAST(D.JORNADA / 60.0 AS decimal(10, 2)) AS varchar(20)), '.', ',')
                      ELSE NULL
                    END
, DTMUDANCA       = CASE
                      WHEN @DATA_BASE = CONVERT(date, '20260301', 112)
    AND D.FONTE IN ('HISTORICO', 'HIST_SEM_CMP')
                        THEN CAST(NULL AS datetime)
                      ELSE D.DTMUDANCA
                    END
, COMPETENCIA     = @COMPETENCIA
FROM DEDUP D
  JOIN PEVENTO PE WITH (NOLOCK)
  ON PE.CODCOLIGADA = @CODCOLIGADA
    AND PE.CODIGO = D.CODEVENTO
WHERE D.RN = 1
  AND D.JORNADA IS NOT NULL
ORDER BY D.CODFILIAL, D.CHAPA, D.CODEVENTO;

/*

WITH QUERY_REMONTADA AS
(
  -- cole a query acima sem o ORDER BY em uma CTE, se quiser comparar direto no banco
),
Q AS
(
  SELECT *, CHAVE = CONCAT(CAST(CODFILIAL AS varchar(10)), '|', CHAPA, '|', CODEVENTO)
  FROM QUERY_REMONTADA
),
A AS
(
  SELECT *, CHAVE = CONCAT(CAST(CODFILIAL AS varchar(10)), '|', CHAPA, '|', CODEVENTO)
  FROM [GestaoBI].dbo.AIN_SALARIO_COMPOSTO WITH (NOLOCK)
  WHERE COMPETENCIA = @COMPETENCIA
)
SELECT 'QTD_QUERY' AS TIPO, COUNT(*) AS QTD FROM Q
UNION ALL SELECT 'QTD_AIN', COUNT(*) FROM A
UNION ALL SELECT 'EXTRA_QUERY', COUNT(*) FROM Q WHERE NOT EXISTS (SELECT 1 FROM A WHERE A.CHAVE = Q.CHAVE)
UNION ALL SELECT 'FALTA_QUERY', COUNT(*) FROM A WHERE NOT EXISTS (SELECT 1 FROM Q WHERE Q.CHAVE = A.CHAVE);
*/


-- Consulta opcional da AIN para conferencia da mesma competencia.
SELECT *
FROM [GestaoBI].dbo.[AIN_SALARIO_COMPOSTO]
WHERE COMPETENCIA = @COMPETENCIA;









-- WITH CTE AS (
-- SELECT DISTINCT 
--   [CODFILIAL] 	= PF.CODFILIAL
-- , [CODEVENTO] 	= PS.CODEVENTO
-- , [DESCRICAO] 	= PE.DESCRICAO
-- , [VALOR_HORA]	= CASE 
--                     WHEN PFHSTSAL.JORNADA <= 0 THEN CAST(PS.VALORORIGINAL AS DECIMAL (10,2))
--                     WHEN PFHSTSAL.JORNADA > 0  THEN CAST(PFHSTSAL.SALARIO /(PFHSTSAL.JORNADA/60.0) AS DECIMAL (10,2))
--                     END
-- , [DTMUDANCA] 	= CAST(PFHSTSAL.DTMUDANCA AS DATE)

-- FROM [CorporeRM].dbo.PFFINANC        PS (NOLOCK)
-- JOIN [CorporeRM].dbo.PFUNC           PF (NOLOCK) ON PS.CODCOLIGADA			  = PF.CODCOLIGADA
-- 									                              AND PS.CHAPA				      = PF.CHAPA
-- JOIN [CorporeRM].dbo.PEVENTO	       PE (NOLOCK) ON PS.CODCOLIGADA			  = PE.CODCOLIGADA
-- 									                              AND PS.CODEVENTO			    = PE.CODIGO
-- LEFT JOIN [CorporeRM].dbo.PFHSTSAL			(NOLOCK) ON PFHSTSAL.CODCOLIGADA  = PS.CODCOLIGADA
--                                                 AND PFHSTSAL.CHAPA			  = PS.CHAPA
--                                                 AND PFHSTSAL.CODEVENTO		= PS.CODEVENTO

-- WHERE PF.CODCOLIGADA = 1
-- --and pf.chapa = '000101056'
-- --AND PF.CODFILIAL = '169' AND PS.CODEVENTO = '0200'
-- AND PF.CODFILIAL BETWEEN '3' AND '207'
-- AND PF.CODSITUACAO NOT IN ('I','C')
-- AND PF.CODRECEBIMENTO = 'P'
-- AND PS.NROPERIODO = '40' --:PERIODO
-- AND PFHSTSAL.MOTIVO IN (03, 06 ,13)
-- AND DTMUDANCA BETWEEN '2023-01-01' AND '2026-02-28'
-- AND PS.CODEVENTO IN (0001,0002,0003,0004,0005,0006,0007,0008,0009,0010,
-- 					 0011,0012,0013,0014,0015,0016,0017,0018,0019,0020,
-- 					 0021,0022,0023,0024,0025,0026,0027,0028,0029,0030,
-- 					 0047,0048,0057,0110,0200,0201,0202,0203,0204,0205,
-- 					 0206,0207,0208,0209,0210,0211,0212,0213,0214,0215,
-- 					 0216,0217,0218,0219,0220,0221,0222,0223,0224,0225,
-- 					 0226,1230,1231,1232,1233)
-- ),

-- CTE2 AS (SELECT CODFILIAL, CODEVENTO, DESCRICAO, VALOR_HORA, MIN(DTMUDANCA) DTMUDANCA
--             FROM CTE
--             GROUP BY CODFILIAL, CODEVENTO, DESCRICAO, VALOR_HORA)

-- /****Transformação dos dados para o insert na tabela ****/
-- SELECT 
--   --[SK]          = ROW_NUMBER() OVER(ORDER BY CODFILIAL, CODEVENTO, DTMUDANCA)
--   [CODFILIAL]   = CODFILIAL
-- , [CODEVENTO]   = CODEVENTO
-- , [DESCRICAO]   = DESCRICAO
-- , [VALOR_HORA]  = VALOR_HORA
-- , [DTINICIO] 	  = DTMUDANCA
-- , [DTFIM] 		  = CASE
--                     WHEN Prox.ProximaData IS NOT NULL THEN DATEADD(DAY, -1, Prox.ProximaData)
--                     WHEN Prox.ProximaData IS NULL THEN '9999-12-31'
--                     END
-- , [ATIVO]       = CASE WHEN Prox.ProximaData IS NULL THEN '1' ELSE '0' END

-- --INTO #AIN_DIM_SALARIO_HORA

-- FROM CTE2 T1
-- OUTER APPLY (SELECT MIN(T2.DTMUDANCA) AS ProximaData
--               FROM CTE2 T2
--               WHERE T2.CODFILIAL = T1.CODFILIAL
--                 AND T2.CODEVENTO = T1.CODEVENTO
--                 AND T2.DTMUDANCA > T1.DTMUDANCA -- Aqui garantimos que pegamos apenas uma data posterior
--               ) Prox
-- WHERE (YEAR(DTMUDANCA) = '2023' and YEAR(ProximaData) >= '2024') or YEAR(DTMUDANCA) >= '2024'
-- ORDER BY T1.CODFILIAL, T1.CODEVENTO, DTINICIO;


-- /*
-- ==================================================================================================================================
-- Consulta de dados
-- ==================================================================================================================================
-- */
-- SELECT DSH.*
-- FROM AIN_DIM_SALARIO_HORA DSH
-- JOIN (SELECT CODFILIAL, CODEVENTO, DESCRICAO, VALOR_HORA, COUNT(distinct motivo) QTD
--       FROM AIN_DIM_SALARIO_HORA
--       GROUP BY CODFILIAL, CODEVENTO, DESCRICAO, VALOR_HORA
--       HAVING COUNT(distinct motivo) > 1) TABELA ON TABELA.CODFILIAL = DSH.CODFILIAL
--                                         AND TABELA.CODEVENTO = DSH.CODEVENTO
--                                         AND TABELA.DESCRICAO = DSH.DESCRICAO
--                                         AND TABELA.VALOR_HORA = DSH.VALOR_HORA
-- WHERE DSH.CODFILIAL IN ('151', '169')
