'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUp,
  Activity,
  AlertTriangle,
  BarChart3,
  Bookmark,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  Filter,
  Home,
  EyeOff,
  Link2,
  Loader2,
  Menu,
  MapPin,
  Moon,
  Play,
  Search,
  Save,
  Settings,
  SlidersHorizontal,
  SunMedium,
  Code2,
  RefreshCw,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import './styles.css';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';
const DEFAULT_FILTERS = {
  query: '',
  source: 'all',
  locationMode: 'remote_brazil',
  tech: 'all',
  salaryOnly: false,
  descriptionOnly: false,
  remoteOnly: false,
  strongMatch: false,
  salaryRange: 'all',
  seniority: 'all',
  city: '',
  period: '30',
  sort: 'posted_desc',
  page: 1,
  pageSize: 25,
  refreshKey: 0
};

const VIEW_META = {
  overview: ['Visão Geral', 'Prioridades, qualidade e movimento da base'],
  jobs: ['Vagas', 'Busca, filtros e acompanhamento das oportunidades'],
  insights: ['Insights', 'Padrões de mercado, aderência e cobertura'],
  sources: ['Fontes', 'Saúde e contribuição dos canais de coleta'],
  schedules: ['Agendamentos', 'Preferências para atualização e recarga da base'],
  technologies: ['Tecnologias', 'Competências mais pedidas e sua distribuição'],
  reports: ['Relatórios', 'Exportações e resumo executivo do recorte'],
  settings: ['Configurações', 'Preferências pessoais e comportamento do dashboard'],
};

const DEFAULT_SCHEDULE = {
  enabled: true,
  frequency: 'daily',
  time: '02:00',
  notifyOnFailure: true,
};

const MANUAL_SCRAPER_SOURCES = [
  { id: 'public', label: 'APIs públicas', detail: 'Jobicy, Remotive, RemoteOK, Arbeitnow e The Muse' },
  { id: 'linkedin', label: 'LinkedIn', detail: 'Busca indireta; requer SERPAPI_KEY' },
  { id: 'indeed', label: 'Indeed', detail: 'Busca indireta; requer SERPAPI_KEY' },
  { id: 'glassdoor', label: 'Glassdoor', detail: 'Busca indireta; requer SERPAPI_KEY' },
  { id: 'gupy', label: 'Gupy', detail: 'Busca indireta; requer SERPAPI_KEY' },
  { id: 'infojobs', label: 'InfoJobs', detail: 'Busca indireta; requer SERPAPI_KEY' },
  { id: 'adzuna', label: 'Adzuna', detail: 'Requer credenciais da API' },
];

function useApiData(filters) {
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [insights, setInsights] = useState(null);
  const [storage, setStorage] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [resumeStore, setResumeStore] = useState({ active_id: null, items: [] });
  const [options, setOptions] = useState({ sources: [], technologies: [], companies: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError('');
      try {
        const params = new URLSearchParams();
        params.set('limit', String(filters.pageSize));
        params.set('offset', String((filters.page - 1) * filters.pageSize));
        params.set('sort', filters.sort);
        if (filters.query) params.set('q', filters.query);
        if (filters.source !== 'all') params.set('source', filters.source);
        if (filters.locationMode !== 'all') params.set('location_mode', filters.locationMode);
        if (filters.tech !== 'all') params.set('tech', filters.tech);
        if (filters.seniority !== 'all') params.set('seniority', filters.seniority);
        if (filters.city) params.set('city', filters.city);
        if (filters.period !== 'all') params.set('days', filters.period);
        if (filters.salaryOnly) params.set('salary', 'with_salary');
        if (filters.descriptionOnly) params.set('has_description', '1');
        if (filters.remoteOnly) params.set('remote_only', '1');
        if (filters.strongMatch) params.set('strong_match', '1');
        const salaryRange = salaryRangeParams(filters.salaryRange);
        if (salaryRange.min_salary) params.set('min_salary', salaryRange.min_salary);
        if (salaryRange.max_salary) params.set('max_salary', salaryRange.max_salary);

        const [jobsRes, insightsRes, filtersRes, storageRes, snapshotRes, resumesRes] = await Promise.all([
          fetch(`${API_BASE}/api/jobs?${params}`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/insights?${params}`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/filters`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/storage`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/snapshot`, { signal: controller.signal }),
          fetch(`${API_BASE}/api/resumes`, { signal: controller.signal })
        ]);
        if (!jobsRes.ok || !insightsRes.ok || !filtersRes.ok || !storageRes.ok || !snapshotRes.ok || !resumesRes.ok) {
          throw new Error('Falha ao conectar com a API Flask');
        }
        const jobsJson = await jobsRes.json();
        const insightsJson = await insightsRes.json();
        const filtersJson = await filtersRes.json();
        const storageJson = await storageRes.json();
        const snapshotJson = await snapshotRes.json();
        const resumesJson = await resumesRes.json();
        setJobs(jobsJson.items ?? []);
        setTotal(jobsJson.total ?? 0);
        setInsights(insightsJson);
        setStorage(storageJson);
        setSnapshot(snapshotJson.snapshot ?? null);
        setResumeStore(resumesJson);
        setOptions(filtersJson);
      } catch (err) {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setJobs([]);
        setTotal(0);
        setInsights(null);
        setStorage(null);
        setSnapshot(null);
        setResumeStore({ active_id: null, items: [] });
        setOptions({ sources: [], technologies: [], companies: [] });
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => controller.abort();
  }, [filters]);

  return { jobs, total, insights, storage, snapshot, resumeStore, options, loading, error };
}

export default function DashboardApp() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [themeReady, setThemeReady] = useState(false);
  const { jobs, total, insights, storage, snapshot, resumeStore, options, loading, error } = useApiData(filters);
  const [selectedId, setSelectedId] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [jobStatuses, setJobStatuses] = useState({});
  const [exportState, setExportState] = useState('');
  const [reloadState, setReloadState] = useState('');
  const [schedule, setSchedule] = useState(DEFAULT_SCHEDULE);
  const [scheduleSaved, setScheduleSaved] = useState(false);
  const [resumeState, setResumeState] = useState({ status: '', message: '' });
  const [scrapeState, setScrapeState] = useState({ status: 'idle', message: 'Carregando estado do coletor...', logs: [] });
  const selectedJob = useMemo(() => jobs.find((job) => job.id === selectedId) ?? jobs[0], [jobs, selectedId]);

  useEffect(() => {
    if (jobs.length && !jobs.some((job) => job.id === selectedId)) {
      setSelectedId(jobs[0].id);
    }
  }, [jobs, selectedId]);

  useEffect(() => {
    const stored = window.localStorage.getItem('datascrap-theme');
    if (stored === 'dark' || stored === 'light') {
      setTheme(stored);
    }
    setThemeReady(true);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE}/api/scrape/status`)
      .then((response) => response.json())
      .then((payload) => { if (active) setScrapeState(payload); })
      .catch(() => { if (active) setScrapeState({ status: 'error', message: 'Não foi possível consultar o coletor.', logs: [] }); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (scrapeState.status !== 'running') return undefined;
    let active = true;
    const timer = window.setInterval(async () => {
      try {
        const response = await fetch(`${API_BASE}/api/scrape/status`);
        const payload = await response.json();
        if (!active) return;
        setScrapeState(payload);
        if (payload.status !== 'running') {
          window.clearInterval(timer);
          setFilters((current) => ({ ...current, refreshKey: current.refreshKey + 1 }));
        }
      } catch {
        if (active) setScrapeState((current) => ({ ...current, status: 'error', message: 'A conexão com o coletor foi interrompida.' }));
      }
    }, 1500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [scrapeState.status]);

  useEffect(() => {
    if (themeReady) {
      window.localStorage.setItem('datascrap-theme', theme);
    }
  }, [theme, themeReady]);

  useEffect(() => {
    if (window.matchMedia('(min-width: 761px)').matches) {
      setDetailOpen(true);
    }
  }, []);

  useEffect(() => {
    try {
      const storedSchedule = JSON.parse(window.localStorage.getItem('datascrap-schedule') || 'null');
      if (storedSchedule) setSchedule((current) => ({ ...current, ...storedSchedule }));
    } catch {
      window.localStorage.removeItem('datascrap-schedule');
    }
  }, []);

  useEffect(() => {
    try {
      const preferences = JSON.parse(window.localStorage.getItem('datascrap-preferences') || 'null');
      if (preferences) {
        setFilters((current) => ({
          ...current,
          pageSize: Number(preferences.pageSize) || current.pageSize,
          locationMode: preferences.locationMode || current.locationMode,
          tech: preferences.tech || current.tech,
        }));
      }
    } catch {
      window.localStorage.removeItem('datascrap-preferences');
    }
  }, []);

  const totalJobs = insights?.total_jobs ?? total;
  const patchFilters = (patch) => setFilters((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const setJobStatus = (id, status) => setJobStatuses((current) => ({ ...current, [id]: status }));
  const navigate = (nextView) => {
    setView(nextView);
    setNavOpen(false);
    if (nextView !== 'overview' && nextView !== 'jobs') setSidebarOpen(false);
  };
  const reloadData = async () => {
    setReloadState('running');
    try {
      const response = await fetch(`${API_BASE}/api/reload`, { method: 'POST' });
      if (!response.ok) throw new Error('Falha ao recarregar a base');
      setFilters((current) => ({ ...current, refreshKey: current.refreshKey + 1 }));
      setReloadState('done');
    } catch {
      setReloadState('error');
    } finally {
      window.setTimeout(() => setReloadState(''), 2400);
    }
  };
  const saveSchedule = () => {
    window.localStorage.setItem('datascrap-schedule', JSON.stringify(schedule));
    setScheduleSaved(true);
    window.setTimeout(() => setScheduleSaved(false), 2200);
  };
  const refreshProfileData = () => setFilters((current) => ({ ...current, refreshKey: current.refreshKey + 1 }));
  const uploadResume = async (file) => {
    if (!file) return;
    setResumeState({ status: 'running', message: 'Extraindo e analisando o currículo...' });
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await fetch(`${API_BASE}/api/resumes`, { method: 'POST', body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível importar o currículo.');
      setResumeState({ status: 'done', message: 'Currículo importado e definido como perfil ativo.' });
      refreshProfileData();
    } catch (error) {
      setResumeState({ status: 'error', message: error.message });
    }
  };
  const activateResume = async (resumeId) => {
    setResumeState({ status: 'running', message: 'Recalculando compatibilidade...' });
    try {
      const response = await fetch(`${API_BASE}/api/resumes/${resumeId}/activate`, { method: 'PUT' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível ativar o currículo.');
      setResumeState({ status: 'done', message: 'Currículo ativo alterado e matches recalculados.' });
      refreshProfileData();
    } catch (error) {
      setResumeState({ status: 'error', message: error.message });
    }
  };
  const deleteResume = async (resumeId) => {
    if (!window.confirm('Remover este currículo do DataScrap?')) return;
    setResumeState({ status: 'running', message: 'Removendo currículo...' });
    try {
      const response = await fetch(`${API_BASE}/api/resumes/${resumeId}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível remover o currículo.');
      setResumeState({ status: 'done', message: 'Currículo removido.' });
      refreshProfileData();
    } catch (error) {
      setResumeState({ status: 'error', message: error.message });
    }
  };
  const startScrape = async (configuration) => {
    setScrapeState((current) => ({ ...current, status: 'starting', message: 'Solicitando nova coleta...', logs: [] }));
    try {
      const response = await fetch(`${API_BASE}/api/scrape`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configuration),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Não foi possível iniciar a coleta.');
      setScrapeState(payload);
    } catch (error) {
      setScrapeState({ status: 'error', message: error.message, logs: [] });
    }
  };
  const exportJobs = (format = 'excel', scope = 'filtered') => {
    const rows = scope === 'selected' ? jobs.filter((job) => selectedIds.includes(job.id)) : jobs;
    setExportState('running');
    try {
      if (format === 'csv') {
        downloadJobsCsv(rows, filters);
      } else {
        downloadJobsExcel(rows, filters);
      }
      setExportState('done');
    } catch {
      setExportState('error');
    } finally {
      window.setTimeout(() => setExportState(''), 2400);
    }
  };
  return (
    <div className="app-shell" data-theme={theme}>
      <SideRail view={view} onNavigate={navigate} insights={insights} navOpen={navOpen} setNavOpen={setNavOpen} />
      {navOpen && <button className="mobile-overlay" aria-label="Fechar navegação" onClick={() => setNavOpen(false)} />}
      <div className="app-frame">
        <TopBar
          latest={latestCollectionLabel(insights?.by_day)}
          loading={loading}
          view={view}
          setView={navigate}
          jobs={jobs}
          statusOpen={statusOpen}
          setStatusOpen={setStatusOpen}
          total={totalJobs}
          error={error}
          storage={storage}
          snapshot={snapshot}
          theme={theme}
          setTheme={setTheme}
          filters={filters}
          setFilters={patchFilters}
          onExport={exportJobs}
          exportState={exportState}
          onToggleNav={() => setNavOpen(true)}
        />
        <div className={`workspace ${!sidebarOpen ? 'sidebar-collapsed' : ''} ${!detailOpen ? 'detail-collapsed' : ''}`}>
          {sidebarOpen && <Sidebar filters={filters} setFilters={patchFilters} options={options} insights={insights} sourceExpanded={sourceExpanded} setSourceExpanded={setSourceExpanded} onClose={() => setSidebarOpen(false)} />}
          <main className="main-content">
            {error && <div className="api-warning">API offline ou indisponível. Inicie o Flask em http://127.0.0.1:5000 para carregar dados reais.</div>}
            <DashboardView
              view={view}
              jobs={jobs}
              total={total}
              insights={insights}
              storage={storage}
              snapshot={snapshot}
              resumeStore={resumeStore}
              options={options}
              loading={loading}
              error={error}
              filters={filters}
              setFilters={patchFilters}
              selectedJob={selectedJob}
              selectedIds={selectedIds}
              setSelectedIds={setSelectedIds}
              jobStatuses={jobStatuses}
              onSelectJob={(id) => {
                setSelectedId(id);
                setDetailOpen(true);
              }}
              detailOpen={detailOpen}
              setDetailOpen={setDetailOpen}
              setJobStatus={setJobStatus}
              onToggleSidebar={() => setSidebarOpen((value) => !value)}
              onExport={exportJobs}
              exportState={exportState}
              reloadState={reloadState}
              onReload={reloadData}
              schedule={schedule}
              setSchedule={setSchedule}
              onSaveSchedule={saveSchedule}
              scheduleSaved={scheduleSaved}
              scrapeState={scrapeState}
              onStartScrape={startScrape}
              theme={theme}
              setTheme={setTheme}
              resumeState={resumeState}
              onUploadResume={uploadResume}
              onActivateResume={activateResume}
              onDeleteResume={deleteResume}
              onNavigate={navigate}
            />
          </main>
        </div>
      </div>
    </div>
  );
}

function DashboardView(props) {
  const { view } = props;
  if (view === 'overview') return <OverviewView {...props} />;
  if (view === 'jobs') return <JobsView {...props} />;
  if (view === 'insights') return <InsightsDashboard {...props} />;
  if (view === 'sources') return <SourcesView {...props} />;
  if (view === 'schedules') return <SchedulesView {...props} />;
  if (view === 'technologies') return <TechnologiesView {...props} />;
  if (view === 'reports') return <ReportsView {...props} />;
  return <SettingsView {...props} />;
}

function OverviewView(props) {
  return (
    <>
      <MetricGrid insights={props.insights} totalJobs={props.insights?.total_jobs ?? props.total} />
      <JobsWorkspace {...props} />
      <ChartGrid insights={props.insights} jobs={props.jobs} className="analytics-strip" compact />
    </>
  );
}

function JobsView(props) {
  return (
    <section className="view-stack">
      <PageHeader
        eyebrow="OPORTUNIDADES"
        title="Central de vagas"
        description="Revise, ordene e acompanhe as oportunidades do recorte atual."
        actions={<button className="action-button" onClick={() => props.onExport('excel', 'filtered')}><Download size={16} /> Exportar recorte</button>}
      />
      <JobsWorkspace {...props} />
    </section>
  );
}

function JobsWorkspace({ jobs, total, selectedJob, onSelectJob, filters, setFilters, loading, selectedIds, setSelectedIds, jobStatuses, onToggleSidebar, detailOpen, setDetailOpen, onExport, setJobStatus }) {
  return (
    <section className={`jobs-layout ${!detailOpen ? 'detail-hidden' : ''}`}>
      <JobsTable
        jobs={jobs}
        total={total}
        selectedJob={selectedJob}
        onSelect={onSelectJob}
        filters={filters}
        setFilters={setFilters}
        loading={loading}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        jobStatuses={jobStatuses}
        onToggleSidebar={onToggleSidebar}
        onToggleDetail={() => setDetailOpen((value) => !value)}
        onExport={onExport}
      />
      {detailOpen && <DetailPanel job={selectedJob} status={jobStatuses[selectedJob?.id]} onStatus={setJobStatus} onClose={() => setDetailOpen(false)} />}
    </section>
  );
}

function InsightsDashboard({ insights, jobs, snapshot }) {
  return (
    <section className="view-stack">
      <PageHeader eyebrow="ANÁLISE" title="Insights do mercado" description="Concentração, tendências e qualidade dos dados no recorte selecionado." />
      <MetricGrid insights={insights} totalJobs={insights?.total_jobs ?? 0} />
      <ChartGrid insights={insights} jobs={jobs} />
      <InsightsView insights={insights} jobs={jobs} snapshot={snapshot} />
    </section>
  );
}

function SourcesView({ insights, storage, error, reloadState, onReload }) {
  const sources = insights?.by_source ?? [];
  const total = Math.max(1, insights?.total_jobs ?? 0);
  const files = storage?.csv_files ?? [];
  return (
    <section className="view-stack">
      <PageHeader
        eyebrow="INGESTÃO"
        title="Fontes de coleta"
        description="Acompanhe a contribuição de cada canal e a origem física dos dados carregados."
        actions={<button className="action-button" onClick={onReload} disabled={reloadState === 'running'}><RefreshCw className={reloadState === 'running' ? 'spin' : ''} size={16} /> {reloadState === 'running' ? 'Recarregando' : 'Recarregar base'}</button>}
      />
      <div className="section-kpis">
        <MiniKpi label="Fontes com dados" value={formatNumber(insights?.sources_active ?? sources.length)} detail="canais presentes no recorte" />
        <MiniKpi label="Arquivos carregados" value={formatNumber(files.length)} detail={storage?.source ? `origem: ${storage.source}` : 'origem indisponível'} />
        <MiniKpi label="Estado da API" value={error ? 'Offline' : 'Online'} detail={error || 'respostas disponíveis'} tone={error ? 'danger' : 'success'} />
        <MiniKpi label="Última publicação" value={latestCollectionLabel(insights?.by_day)} detail="data mais recente no recorte" />
      </div>
      {reloadState === 'done' && <InlineNotice tone="success">Base recarregada e indicadores atualizados.</InlineNotice>}
      {reloadState === 'error' && <InlineNotice tone="danger">Não foi possível recarregar a base.</InlineNotice>}
      <div className="source-grid">
        {sources.map((source) => {
          const share = Math.round((source.count / total) * 100);
          return (
            <article className="source-card" key={source.name}>
              <div className="source-card-head"><SourceMark source={source.name} /><span className="status-badge success"><CheckCircle2 size={13} /> Ativa</span></div>
              <strong>{formatNumber(source.count)}</strong>
              <small>{share}% das vagas no recorte</small>
              <div className="source-progress"><i style={{ width: `${share}%` }} /></div>
              <button onClick={() => window.open(sourceHomepage(source.name), '_blank', 'noopener,noreferrer')}>Abrir fonte <ExternalLink size={14} /></button>
            </article>
          );
        })}
        {!sources.length && <EmptyState title="Nenhuma fonte com dados" description="Recarregue a base ou revise os arquivos disponíveis." />}
      </div>
      <section className="content-panel">
        <div className="panel-heading"><div><h2>Arquivos da base</h2><p>Entradas reconhecidas pela API na carga atual.</p></div><Database size={19} /></div>
        <div className="file-list">
          {files.map((file) => <div key={file}><FileText size={16} /><span>{file}</span><strong>CSV</strong></div>)}
          {!files.length && <EmptyState title="Nenhum arquivo encontrado" description="A API não informou arquivos CSV para esta carga." />}
        </div>
      </section>
    </section>
  );
}

function SchedulesView({ schedule, setSchedule, onSaveSchedule, scheduleSaved, reloadState, onReload, insights, scrapeState, onStartScrape }) {
  return (
    <section className="view-stack narrow-view">
      <PageHeader eyebrow="AUTOMAÇÃO" title="Agendamentos" description="Execute a coleta quando quiser e defina suas preferências de atualização." />
      {scheduleSaved && <InlineNotice tone="success">Preferências de agendamento salvas neste navegador.</InlineNotice>}
      <ManualScrapeRunner scrapeState={scrapeState} onStart={onStartScrape} />
      <section className="content-panel form-panel">
        <div className="panel-heading"><div><h2>Rotina de atualização</h2><p>A configuração fica associada a este perfil local.</p></div><CalendarDays size={20} /></div>
        <SettingRow title="Agendamento ativo" description="Mantém a rotina marcada como habilitada no dashboard.">
          <button className={`toggle ${schedule.enabled ? 'on' : ''}`} aria-label="Alternar agendamento" aria-pressed={schedule.enabled} onClick={() => setSchedule((current) => ({ ...current, enabled: !current.enabled }))}><i /></button>
        </SettingRow>
        <SettingRow title="Frequência" description="Periodicidade preferida para atualização.">
          <select value={schedule.frequency} onChange={(event) => setSchedule((current) => ({ ...current, frequency: event.target.value }))}><option value="daily">Diariamente</option><option value="weekdays">Dias úteis</option><option value="weekly">Semanalmente</option></select>
        </SettingRow>
        <SettingRow title="Horário" description="Horário local de Brasília.">
          <input type="time" value={schedule.time} onChange={(event) => setSchedule((current) => ({ ...current, time: event.target.value }))} />
        </SettingRow>
        <SettingRow title="Avisar em caso de falha" description="Registra a preferência de notificação do perfil.">
          <button className={`toggle ${schedule.notifyOnFailure ? 'on' : ''}`} aria-label="Alternar aviso de falha" aria-pressed={schedule.notifyOnFailure} onClick={() => setSchedule((current) => ({ ...current, notifyOnFailure: !current.notifyOnFailure }))}><i /></button>
        </SettingRow>
        <div className="form-actions"><button className="action-button" onClick={onSaveSchedule}><Save size={16} /> Salvar preferências</button></div>
      </section>
      <section className="content-panel">
        <div className="panel-heading"><div><h2>Atualização manual</h2><p>Releia agora os arquivos e snapshots disponíveis para a API.</p></div><RefreshCw size={20} /></div>
        <div className="manual-refresh">
          <div><span>Última data no recorte</span><strong>{latestCollectionLabel(insights?.by_day)}</strong></div>
          <button className="outline-button" onClick={onReload} disabled={reloadState === 'running'}>{reloadState === 'running' ? <Loader2 className="spin" size={16} /> : <RefreshCw size={16} />} Recarregar arquivos</button>
        </div>
      </section>
    </section>
  );
}

function ManualScrapeRunner({ scrapeState, onStart }) {
  const [sources, setSources] = useState(['public']);
  const [query, setQuery] = useState('engenheiro de dados junior,analista de dados junior,desenvolvedor python');
  const [forceRefresh, setForceRefresh] = useState(false);
  const running = scrapeState?.status === 'running' || scrapeState?.status === 'starting';
  const toggleSource = (source) => {
    setSources((current) => current.includes(source) ? current.filter((item) => item !== source) : [...current, source]);
  };

  return (
    <section className="content-panel scraper-runner">
      <div className="panel-heading">
        <div><h2>Coleta manual</h2><p>Inicie o scraper Go agora; apenas uma execução pode ficar ativa por vez.</p></div>
        {running ? <Loader2 className="spin" size={20} /> : <Play size={20} />}
      </div>

      <div className="scraper-source-grid">
        {MANUAL_SCRAPER_SOURCES.map((source) => (
          <label className={sources.includes(source.id) ? 'selected' : ''} key={source.id}>
            <input type="checkbox" checked={sources.includes(source.id)} onChange={() => toggleSource(source.id)} />
            <span><strong>{source.label}</strong><small>{source.detail}</small></span>
          </label>
        ))}
      </div>

      <label className="scraper-query">
        <span>Termos de busca</span>
        <textarea rows="3" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Separe os cargos e tecnologias por vírgula" />
      </label>

      <div className="scraper-actions">
        <label className="cache-option">
          <input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} />
          <span>Ignorar cache nesta execução</span>
        </label>
        <button className="action-button" disabled={running || !sources.length} onClick={() => onStart({ sources, query, force_refresh: forceRefresh })}>
          {running ? <Loader2 className="spin" size={16} /> : <Play size={16} />}
          {running ? 'Coletando vagas' : 'Iniciar coleta agora'}
        </button>
      </div>

      <div className={`scraper-status ${scrapeState?.status || 'idle'}`} role="status">
        <div>
          <span>{scrapeStatusLabel(scrapeState?.status)}</span>
          <strong>{scrapeState?.message || 'Pronto para iniciar.'}</strong>
        </div>
        {scrapeState?.started_at && <small>Início: {dateTimeLabel(scrapeState.started_at)}</small>}
        {scrapeState?.output_file && <small>Saída: {scrapeState.output_file}</small>}
      </div>

      {!!scrapeState?.logs?.length && (
        <details className="scraper-logs">
          <summary>Ver logs da última coleta</summary>
          <pre>{scrapeState.logs.join('\n')}</pre>
        </details>
      )}
    </section>
  );
}

function TechnologiesView({ insights, jobs, filters, setFilters, onNavigate }) {
  const technologies = insights?.by_technology ?? [];
  const total = Math.max(1, insights?.total_jobs ?? 0);
  const jobsWithTechnology = insights?.data_coverage?.find((item) => normalizeKey(item.name).includes('tecnolog'))?.count ?? 0;
  return (
    <section className="view-stack">
      <PageHeader eyebrow="COMPETÊNCIAS" title="Tecnologias" description="Veja o que aparece nas vagas e use o ranking para refinar sua busca." />
      <div className="section-kpis">
        <MiniKpi label="Tecnologias detectadas" value={formatNumber(technologies.length)} detail="competências distintas no recorte" />
        <MiniKpi label="Vagas mapeadas" value={formatNumber(jobsWithTechnology)} detail={`${percentLabel(jobsWithTechnology, total)} da base`} />
        <MiniKpi label="Mais frequente" value={technologies[0]?.name || 'Sem dados'} detail={technologies[0] ? `${formatNumber(technologies[0].count)} ocorrências` : 'nenhuma ocorrência'} />
      </div>
      <div className="two-column-view">
        <section className="content-panel">
          <div className="panel-heading"><div><h2>Ranking de tecnologias</h2><p>Clique em uma tecnologia para abrir as vagas correspondentes.</p></div><Code2 size={20} /></div>
          <div className="technology-ranking">
            {technologies.map((technology, index) => (
              <button key={technology.name} onClick={() => { setFilters({ tech: technology.name }); onNavigate('jobs'); }}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <strong>{technology.name}</strong>
                <i><b style={{ width: `${Math.max(4, (technology.count / (technologies[0]?.count || 1)) * 100)}%` }} /></i>
                <em>{formatNumber(technology.count)}</em>
              </button>
            ))}
            {!technologies.length && <EmptyState title="Tecnologias não detectadas" description="As vagas do recorte ainda não possuem competências mapeadas." />}
          </div>
        </section>
        <ChartCard title="Tecnologias por senioridade" subtitle="Ocorrências por nível informado"><TechMatrix matrix={buildTechnologySeniorityMatrix(jobs)} /></ChartCard>
      </div>
    </section>
  );
}

function ReportsView({ insights, jobs, filters, onExport, exportState }) {
  return (
    <section className="view-stack">
      <PageHeader eyebrow="SAÍDA" title="Relatórios e exportações" description="Gere arquivos do recorte atual e consulte a completude antes de compartilhar." />
      <div className="report-actions">
        <button onClick={() => onExport('excel', 'filtered')} disabled={exportState === 'running'}><FileSpreadsheet size={22} /><span><strong>Excel do recorte</strong><small>Vagas e filtros aplicados</small></span><Download size={16} /></button>
        <button onClick={() => onExport('csv', 'filtered')} disabled={exportState === 'running'}><FileText size={22} /><span><strong>CSV do recorte</strong><small>Formato simples para análise</small></span><Download size={16} /></button>
        <button onClick={() => window.print()}><FileText size={22} /><span><strong>Resumo executivo</strong><small>KPIs e visões para impressão</small></span><ExternalLink size={16} /></button>
      </div>
      <div className="two-column-view reports-grid">
        <section className="content-panel report-summary">
          <div className="panel-heading"><div><h2>Resumo do recorte</h2><p>Contexto que acompanha a tomada de decisão.</p></div><Activity size={20} /></div>
          <ReportLine label="Vagas disponíveis" value={formatNumber(insights?.total_jobs ?? jobs.length)} />
          <ReportLine label="Match médio" value={`${Math.round(insights?.average_match ?? 0)}%`} />
          <ReportLine label="Matches fortes" value={formatNumber(insights?.strong_matches ?? 0)} />
          <ReportLine label="Fontes presentes" value={formatNumber(insights?.sources_active ?? 0)} />
          <ReportLine label="Período" value={periodRangeLabel(filters.period)} />
        </section>
        <ChartCard title="Cobertura para exportação" subtitle="Campos disponíveis no recorte atual"><CoverageBars data={insights?.data_coverage ?? {}} /></ChartCard>
      </div>
    </section>
  );
}

function SettingsView({ theme, setTheme, filters, setFilters, options, resumeStore, resumeState, onUploadResume, onActivateResume, onDeleteResume }) {
  const [saved, setSaved] = useState(false);
  const savePreferences = () => {
    window.localStorage.setItem('datascrap-preferences', JSON.stringify({ theme, pageSize: filters.pageSize, locationMode: filters.locationMode, tech: filters.tech }));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  };
  return (
    <section className="view-stack narrow-view">
      <PageHeader eyebrow="PREFERÊNCIAS" title="Configurações" description="Ajuste a experiência padrão do dashboard neste navegador." />
      {saved && <InlineNotice tone="success">Preferências salvas.</InlineNotice>}
      <ResumeManager
        resumeStore={resumeStore}
        state={resumeState}
        onUpload={onUploadResume}
        onActivate={onActivateResume}
        onDelete={onDeleteResume}
      />
      <section className="content-panel form-panel">
        <div className="panel-heading"><div><h2>Aparência e navegação</h2><p>Controles aplicados imediatamente ao dashboard.</p></div><Settings size={20} /></div>
        <SettingRow title="Tema escuro" description="Alterna contraste e superfícies da interface.">
          <button className={`toggle ${theme === 'dark' ? 'on' : ''}`} aria-label="Alternar tema escuro" aria-pressed={theme === 'dark'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}><i /></button>
        </SettingRow>
        <SettingRow title="Vagas por página" description="Quantidade padrão na tabela principal.">
          <select value={filters.pageSize} onChange={(event) => setFilters({ pageSize: Number(event.target.value), page: 1 })}><option value="10">10</option><option value="25">25</option><option value="50">50</option><option value="100">100</option></select>
        </SettingRow>
        <SettingRow title="Localização padrão" description="Recorte aplicado às consultas de vagas.">
          <select value={filters.locationMode} onChange={(event) => setFilters({ locationMode: event.target.value })}><option value="remote_brazil">Remoto Brasil</option><option value="brasilia">Brasília híbrido/presencial</option><option value="all">Todas</option></select>
        </SettingRow>
        <SettingRow title="Tecnologia inicial" description="Filtro preferido ao abrir a central de vagas.">
          <select value={filters.tech} onChange={(event) => setFilters({ tech: event.target.value })}><option value="all">Todas</option>{(options?.technologies ?? []).map((tech) => <option value={tech} key={tech}>{tech}</option>)}</select>
        </SettingRow>
        <div className="form-actions"><button className="action-button" onClick={savePreferences}><Save size={16} /> Salvar configurações</button></div>
      </section>
      <InlineNotice tone="warning"><AlertTriangle size={17} /> Preferências ficam neste navegador; dados das vagas continuam vindo exclusivamente da API.</InlineNotice>
    </section>
  );
}

function ResumeManager({ resumeStore, state, onUpload, onActivate, onDelete }) {
  const resumes = resumeStore?.items ?? [];
  const activeResume = resumes.find((resume) => resume.active);
  return (
    <section className="content-panel resume-panel">
      <div className="panel-heading">
        <div>
          <h2>Currículos para compatibilidade</h2>
          <p>O currículo ativo define as tecnologias e palavras-chave usadas no cálculo de match.</p>
        </div>
        <FileText size={20} />
      </div>

      <div className="resume-overview">
        <div>
          <span>Perfil ativo</span>
          <strong>{activeResume?.name || 'Nenhum currículo importado'}</strong>
          <small>{activeResume ? `${activeResume.skills.length} tecnologias identificadas` : 'importe um arquivo para habilitar o match personalizado'}</small>
        </div>
        <label className={`resume-upload ${state?.status === 'running' ? 'disabled' : ''}`}>
          {state?.status === 'running' ? <Loader2 className="spin" size={18} /> : <Upload size={18} />}
          <span>{state?.status === 'running' ? 'Analisando...' : 'Importar currículo'}</span>
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            disabled={state?.status === 'running'}
            onChange={(event) => {
              onUpload(event.target.files?.[0]);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {state?.message && <InlineNotice tone={state.status === 'error' ? 'danger' : state.status === 'done' ? 'success' : ''}>{state.message}</InlineNotice>}

      <div className="resume-list">
        {resumes.map((resume) => (
          <div className={`resume-row ${resume.active ? 'active' : ''}`} key={resume.id}>
            <div className="resume-file-mark"><FileText size={18} /></div>
            <div className="resume-copy">
              <div><strong>{resume.name}</strong>{resume.active && <span className="status-badge success"><CheckCircle2 size={12} /> Ativo</span>}</div>
              <small>{resume.filename} · {dateTimeLabel(resume.uploaded_at)}</small>
              <div className="resume-skills">
                {resume.skills.slice(0, 7).map((skill) => <span key={skill}>{skill}</span>)}
                {resume.skills.length > 7 && <em>+{resume.skills.length - 7}</em>}
                {!resume.skills.length && <em>Nenhuma tecnologia reconhecida</em>}
              </div>
            </div>
            <div className="resume-actions">
              {!resume.active && <button className="outline-button" onClick={() => onActivate(resume.id)}>Usar no match</button>}
              <button className="icon-button danger" aria-label={`Remover ${resume.name}`} onClick={() => onDelete(resume.id)}><Trash2 size={16} /></button>
            </div>
          </div>
        ))}
        {!resumes.length && <EmptyState title="Nenhum currículo configurado" description="Importe um PDF, DOCX ou TXT para personalizar o score de cada vaga." />}
      </div>
      <div className="resume-privacy"><Database size={15} /><span>Os arquivos ficam armazenados localmente na pasta de dados do projeto e não são enviados a serviços externos.</span></div>
    </section>
  );
}

function PageHeader({ eyebrow, title, description, actions }) {
  return <header className="page-header"><div><span>{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{actions && <div className="page-actions">{actions}</div>}</header>;
}

function MiniKpi({ label, value, detail, tone = '' }) {
  return <article className={`mini-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function InlineNotice({ children, tone }) {
  return <div className={`inline-notice ${tone || ''}`}>{children}</div>;
}

function EmptyState({ title, description }) {
  return <div className="empty-state"><Database size={22} /><strong>{title}</strong><span>{description}</span></div>;
}

function SettingRow({ title, description, children }) {
  return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div><div>{children}</div></div>;
}

function ReportLine({ label, value }) {
  return <div className="report-line"><span>{label}</span><strong>{value}</strong></div>;
}

function SideRail({ view, onNavigate, insights, navOpen, setNavOpen }) {
  const sources = insights?.by_source?.slice(0, 8) ?? [];
  const activeSources = insights?.sources_active ?? sources.length;

  return (
    <aside className={`side-rail ${navOpen ? 'open' : ''}`} aria-label="Navegação principal">
      <div className="rail-brand">
        <div className="rail-logo">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div>
          <strong>DataScrap</strong>
          <small>Vagas de Dados & Tech</small>
        </div>
        <button className="rail-close" aria-label="Fechar navegação" onClick={() => setNavOpen(false)}><X size={18} /></button>
      </div>
      <nav>
        <button className={view === 'overview' ? 'active' : ''} onClick={() => onNavigate('overview')} title="Visão Geral">
          <Home size={18} />
          <span>Visão Geral</span>
        </button>
        <button className={view === 'jobs' ? 'active' : ''} onClick={() => onNavigate('jobs')} title="Vagas">
          <BriefcaseBusiness size={20} />
          <span>Vagas</span>
        </button>
        <button className={view === 'insights' ? 'active' : ''} onClick={() => onNavigate('insights')} title="Insights">
          <BarChart3 size={19} />
          <span>Insights</span>
        </button>
        <button className={view === 'sources' ? 'active' : ''} onClick={() => onNavigate('sources')} title="Fontes">
          <Database size={18} />
          <span>Fontes</span>
        </button>
        <button className={view === 'schedules' ? 'active' : ''} onClick={() => onNavigate('schedules')} title="Agendamentos">
          <CalendarDays size={18} />
          <span>Agendamentos</span>
        </button>
        <button className={view === 'technologies' ? 'active' : ''} onClick={() => onNavigate('technologies')} title="Tecnologias">
          <Code2 size={18} />
          <span>Tecnologias</span>
        </button>
        <button className={view === 'reports' ? 'active' : ''} onClick={() => onNavigate('reports')} title="Relatórios">
          <FileText size={18} />
          <span>Relatórios</span>
        </button>
        <button className={view === 'settings' ? 'active' : ''} onClick={() => onNavigate('settings')} title="Configurações">
          <Settings size={18} />
          <span>Configurações</span>
        </button>
      </nav>
      <div className="rail-sources">
        <div className="rail-sources-head">
          <strong>Fontes ativas</strong>
          <span>{activeSources}/10</span>
        </div>
        {sources.map((source) => (
          <div className="rail-source-row" key={source.name}>
            <i />
            <span>{sourceLabel(source.name)}</span>
            <strong>{formatNumber(source.count)}</strong>
          </div>
        ))}
        <button onClick={() => onNavigate('sources')}>Ver todas as fontes</button>
      </div>
      <div className="rail-user">
        <span>JV</span>
        <div>
          <strong>Data Engineer</strong>
          <small>Plano Pro</small>
        </div>
      </div>
    </aside>
  );
}

function TopBar({ latest, loading, view, setView, statusOpen, setStatusOpen, total, error, storage, snapshot, theme, setTheme, jobs, filters, setFilters, onExport, exportState, onToggleNav }) {
  const [viewTitle, viewSubtitle] = VIEW_META[view] ?? VIEW_META.overview;
  return (
    <header className="topbar">
      <button className="mobile-menu" aria-label="Abrir navegação" onClick={onToggleNav}><Menu size={20} /></button>
      <div className="brand-block">
        <div className="brand-title">{viewTitle}</div>
        <p>{viewSubtitle}</p>
      </div>
      <label className="global-search">
        <Search size={17} />
        <input
          value={filters.query}
          onChange={(event) => setFilters({ query: event.target.value })}
          onKeyDown={(event) => { if (event.key === 'Enter') setView('jobs'); }}
          placeholder="Buscar título, empresa, tecnologia ou descrição"
        />
      </label>
      <div className="top-actions">
        <button className="action-button" onClick={() => onExport('excel', 'filtered')} disabled={loading || exportState === 'running'}>
          <Download size={16} />
          {exportState === 'running' ? 'Exportando...' : 'Exportar Excel'}
        </button>
        <button className="outline-button compact-action" onClick={() => onExport('csv', 'filtered')} disabled={loading || exportState === 'running'}>CSV</button>
        <div className="status-pill">
          <span className="live-dot" />
          {error ? 'API Offline' : 'API Online'}
        </div>
        <div className="status-pill">
          <Clock3 size={16} />
          Última coleta: {latest}
        </div>
        <button className="theme-toggle" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-pressed={theme === 'dark'} aria-label="Alternar tema">
          {theme === 'dark' ? <Moon size={16} /> : <SunMedium size={16} />}
          <span className={`toggle ${theme === 'dark' ? 'on' : ''}`}><i /></span>
        </button>
        <button className="icon-button" aria-label="Configurações" onClick={() => setView('settings')}>
          {loading ? <Loader2 className="spin" size={18} /> : <Settings size={18} />}
        </button>
      </div>
    </header>
  );
}

function Sidebar({ filters, setFilters, options, insights, sourceExpanded, setSourceExpanded, onClose }) {
  const sources = options.sources ?? [];
  const techs = options.technologies ?? [];
  const sourceCounts = countMap(insights?.by_source);
  const techCounts = countMap(insights?.by_technology);

  return (
    <aside className="sidebar">
      <div className="filter-header">
        <h2>Filtros</h2>
        <button className="clear-filters" onClick={() => setFilters(DEFAULT_FILTERS)}>
          Limpar tudo
        </button>
        <button className="filter-close" aria-label="Fechar filtros" onClick={onClose}><X size={18} /></button>
      </div>

      <section className="filter-section">
        <Label>Fontes</Label>
        <CheckboxRow label="Todas" count={insights?.total_jobs ?? 0} checked={filters.source === 'all'} onClick={() => setFilters({ ...filters, source: 'all' })} />
        {(sourceExpanded ? sources : sources.slice(0, 5)).map((source) => (
          <CheckboxRow
            key={source}
            label={sourceLabel(source)}
            count={sourceCounts.get(source) ?? 0}
            checked={filters.source === source}
            onClick={() => setFilters({ ...filters, source })}
          />
        ))}
        {sources.length > 5 && (
          <button className="subtle-link" onClick={() => setSourceExpanded(!sourceExpanded)}>
            {sourceExpanded ? 'Ver menos' : 'Ver mais'} <ChevronDown size={14} />
          </button>
        )}
      </section>

      <section className="filter-section">
        <Label>Localização</Label>
        <NativeSelect value={filters.locationMode} onChange={(value) => setFilters({ locationMode: value })}>
          <option value="remote_brazil">Remoto Brasil</option>
          <option value="brasilia">Brasília presencial/híbrido</option>
          <option value="all">Todas do Brasil mapeadas</option>
        </NativeSelect>
        <ToggleRow label="Incluir vagas presenciais" checked={filters.locationMode === 'all'} onClick={() => setFilters({ locationMode: filters.locationMode === 'all' ? 'remote_brazil' : 'all' })} />
        <div className="small-label">Cidade (opcional)</div>
        <TextInput value={filters.city} placeholder="Ex.: Brasília" onChange={(value) => setFilters({ city: value })} />
      </section>

      <section className="filter-section">
        <Label>Nível de senioridade</Label>
        <CheckboxRow label="Todos" checked={filters.seniority === 'all'} onClick={() => setFilters({ seniority: 'all' })} />
        {['Estagio', 'Junior', 'Pleno', 'Senior', 'Especialista'].map((label) => (
          <CheckboxRow key={label} label={seniorityLabel(label)} checked={filters.seniority === label} onClick={() => setFilters({ seniority: filters.seniority === label ? 'all' : label })} />
        ))}
      </section>

      <section className="filter-section">
        <Label>Tecnologias</Label>
        <div className="tech-grid">
          {techs.slice(0, 8).map((tech) => (
            <button
              key={tech}
              className={`tech-token ${filters.tech === tech ? 'selected' : ''}`}
              onClick={() => setFilters({ ...filters, tech: filters.tech === tech ? 'all' : tech })}
            >
              <span>{tech}</span>
              <small>{techCounts.get(tech) ?? 0}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="filter-section">
        <Label>Período de publicação</Label>
        <NativeSelect value={filters.period} onChange={(value) => setFilters({ period: value })}>
          <option value="7">Últimos 7 dias</option>
          <option value="30">Últimos 30 dias</option>
          <option value="90">Últimos 90 dias</option>
          <option value="all">Todo o histórico</option>
        </NativeSelect>
        <div className="date-range">
          <span>{periodRangeLabel(filters.period)}</span>
          <CalendarDays size={15} />
        </div>
      </section>

      <section className="filter-section">
        <Label>Faixa salarial</Label>
        <ToggleRow label="Somente com salário" checked={filters.salaryOnly} onClick={() => setFilters({ salaryOnly: !filters.salaryOnly })} />
        <NativeSelect value={filters.salaryRange} onChange={(value) => setFilters({ salaryRange: value, salaryOnly: value !== 'all' || filters.salaryOnly })}>
          <option value="all">Qualquer faixa</option>
          <option value="0-8000">Até R$ 8 mil</option>
          <option value="8000-15000">R$ 8 mil a R$ 15 mil</option>
          <option value="15000+">Acima de R$ 15 mil</option>
        </NativeSelect>
      </section>

      <section className="filter-section">
        <Label>Qualidade e prioridade</Label>
        <ToggleRow label="Somente com descrição" checked={filters.descriptionOnly} onClick={() => setFilters({ descriptionOnly: !filters.descriptionOnly })} />
        <ToggleRow label="Apenas vagas remotas" checked={filters.remoteOnly} onClick={() => setFilters({ remoteOnly: !filters.remoteOnly })} />
        <ToggleRow label="Apenas matches fortes" checked={filters.strongMatch} onClick={() => setFilters({ strongMatch: !filters.strongMatch })} />
      </section>
    </aside>
  );
}

function Label({ children }) {
  return (
    <div className="filter-label">
      {children}
      <span>i</span>
    </div>
  );
}

function CheckboxRow({ label, count, checked, onClick }) {
  return (
    <button className="check-row" onClick={onClick}>
      <span className={`box ${checked ? 'checked' : ''}`}>{checked && <Check size={12} />}</span>
      <span>{label}</span>
      {typeof count === 'number' && <small>{formatNumber(count)}</small>}
    </button>
  );
}

function ToggleRow({ label, checked, onClick }) {
  return (
    <button className="toggle-row" onClick={onClick}>
      <span>{label}</span>
      <span className={`toggle ${checked ? 'on' : ''}`}><i /></span>
    </button>
  );
}

function NativeSelect({ value, onChange, children }) {
  return (
    <select className="native-select" value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  );
}

function TextInput({ value, placeholder, onChange }) {
  return (
    <input className="text-filter" value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
  );
}

function MetricGrid({ insights, totalJobs, className = '' }) {
  const average = Math.round(insights?.average_match ?? 0);
  const descriptionCoverage = insights?.data_coverage?.find((item) => item.name?.toLowerCase().includes('descri'))?.rate
    ?? insights?.data_coverage?.find((item) => item.name === 'Link')?.rate
    ?? 0;
  const latestDayCount = insights?.by_day?.at?.(-1)?.count ?? 0;

  return (
    <section className={`metric-grid ${className}`.trim()}>
      <MetricCard title="Vagas no recorte" value={formatNumber(totalJobs)} meta={`${formatNumber(insights?.total_jobs ?? 0)} na base filtrada`} />
      <MetricCard title="Match médio" value={`${Number.isFinite(average) ? average : 0}%`} trend={`${formatNumber(insights?.strong_matches ?? 0)} matches fortes`} />
      <MetricCard title="Matches fortes" value={formatNumber(insights?.strong_matches ?? 0)} meta="score acima de 85%" />
      <MetricCard title="Remoto Brasil" value={formatNumber(insights?.remote_brazil_jobs ?? 0)} meta="vagas elegíveis nacionalmente" />
      <MetricCard title="Últimas 24h" value={formatNumber(latestDayCount)} meta="novas/publicadas no último dia" />
      <MetricCard title="Cobertura" value={`${formatNumber(descriptionCoverage)}%`} accent="descrições disponíveis" />
    </section>
  );
}

function MetricCard({ title, value, trend, accent, meta, icon }) {
  return (
    <article className="metric-card">
      <span>{title}</span>
      <strong>{value}</strong>
      {trend && <small className="trend"><ArrowUp size={15} /> {trend}</small>}
      {accent && <small className="accent-note">{accent}</small>}
      {meta && <small className="meta-note">{icon}{meta}</small>}
    </article>
  );
}

function ChartGrid({ insights, jobs = [], className = '', compact = false }) {
  const dayData = insights?.by_day?.length ? insights.by_day : [];
  const sourceData = insights?.by_source?.length ? insights.by_source : [];
  const seniorityData = insights?.by_seniority?.length ? insights.by_seniority : [];
  const modelData = insights?.by_location_mode?.length ? insights.by_location_mode : [];
  const technologyData = insights?.by_technology?.length ? insights.by_technology : [];
  const matrix = buildTechnologySeniorityMatrix(jobs);
  const coverageData = insights?.data_coverage ?? [];

  return (
    <section className={`chart-grid ${className}`.trim()}>
      <ChartCard title="Distribuição por fonte" subtitle="Onde as oportunidades estão concentradas">
        <HorizontalBars data={sourceData.slice(0, 8)} />
      </ChartCard>
      <ChartCard title="Ritmo de publicação" subtitle="Volume diário no período selecionado">
        <LineChart data={dayData.slice(-18).map((item) => ({ label: item.date?.slice(5) ?? '', value: item.count }))} />
      </ChartCard>
      <ChartCard title="Tecnologias por senioridade" subtitle="Competências que aparecem em cada nível">
        <TechMatrix matrix={matrix} />
      </ChartCard>
      <ChartCard title="Completude da coleta" subtitle="Campos disponíveis para decidir e priorizar">
        <CoverageBars data={coverageData} />
      </ChartCard>
      {!compact && <ChartCard title="Distribuição por nível" subtitle="Senioridade declarada ou inferida"><HorizontalBars data={seniorityData.slice(0, 6)} labelFormatter={seniorityLabel} /></ChartCard>}
      {!compact && <ChartCard title="Modelo de trabalho" subtitle="Remoto, híbrido e presencial"><HorizontalBars data={modelData.slice(0, 5)} labelFormatter={(value) => locationModeLabel(value)} /></ChartCard>}
      {!compact && <ChartCard title="Tecnologias mais citadas" subtitle="Ranking das competências encontradas"><HorizontalBars data={technologyData.slice(0, 8)} labelFormatter={(value) => value} /></ChartCard>}
    </section>
  );
}

function ChartCard({ title, subtitle, children }) {
  return (
    <article className="chart-card">
      <header className="chart-heading">
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>
      {children}
    </article>
  );
}

function LineChart({ data }) {
  if (!data.length) return <EmptyChart message="Sem histórico de vagas" />;
  const values = data.map((item) => item.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = Math.max(max - min, 1);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * 280;
    const y = 130 - ((value - min) / range) * 95;
    return `${x},${y}`;
  });
  return (
    <div className="line-chart">
      <svg viewBox="0 0 300 150" role="img" aria-label="Série temporal do volume de vagas">
        <title>Volume de vagas por dia</title>
        <line x1="0" y1="32" x2="300" y2="32" />
        <line x1="0" y1="72" x2="300" y2="72" />
        <line x1="0" y1="112" x2="300" y2="112" />
        <polyline points={points.join(' ')} />
        {points.map((point, index) => {
          const [x, y] = point.split(',');
          return <circle key={index} cx={x} cy={y} r="2.4" />;
        })}
      </svg>
      <div className="line-axis-labels">
        {data.map((item, index) => index % 5 === 0 ? <small key={`${item.label}-${index}`}>{item.label}</small> : null)}
      </div>
      <span className="sr-only">Valores por data: {data.map((item) => `${item.label}: ${item.value}`).join(', ')}</span>
    </div>
  );
}

function HorizontalBars({ data, labelFormatter = sourceLabel }) {
  if (!data.length) return <EmptyChart message="Sem dados para comparar" />;
  const max = Math.max(...data.map((item) => item.count), 1);
  return (
    <div className="hbars">
      {data.map((item) => (
        <div className="hbar-row" key={item.name}>
          <span>{labelFormatter(item.name)}</span>
          <div><i style={{ width: `${(item.count / max) * 100}%` }} /></div>
          <strong>{formatNumber(item.count)}</strong>
        </div>
      ))}
    </div>
  );
}

function CoverageBars({ data }) {
  if (!data.length) return <EmptyChart message="Sem cobertura calculada" />;
  return (
    <div className="coverage-bars">
      {data.map((item) => (
        <div className="coverage-bar" key={item.name}>
          <div><span>{item.name}</span><strong>{formatNumber(item.rate)}%</strong></div>
          <i><b style={{ width: `${Math.max(0, Math.min(100, item.rate))}%` }} /></i>
        </div>
      ))}
    </div>
  );
}

function TechMatrix({ matrix }) {
  if (!matrix.technologies.length || !matrix.seniorities.length) return <EmptyChart message="Sem matriz de tecnologias" />;
  const max = Math.max(...matrix.rows.flatMap((row) => row.values), 1);
  return (
    <div className="tech-matrix">
      <div className="matrix-head" />
      {matrix.seniorities.map((seniority) => <strong key={seniority}>{seniority}</strong>)}
      {matrix.rows.map((row) => (
        <React.Fragment key={row.tech}>
          <span>{row.tech}</span>
          {row.values.map((value, index) => (
            <i
              key={`${row.tech}-${matrix.seniorities[index]}`}
              title={`${row.tech} em ${matrix.seniorities[index]}: ${value}`}
              style={{ opacity: value ? Math.min(0.96, Math.max(0.18, value / max)) : 0.08 }}
            >
              {value ? formatCompact(value) : ''}
            </i>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}

function EmptyChart({ message }) {
  return <div className="empty-chart">{message}</div>;
}

function JobsTable({ jobs, total, selectedJob, onSelect, filters, setFilters, loading, selectedIds, setSelectedIds, jobStatuses, onToggleSidebar, onToggleDetail, onExport }) {
  const totalPages = Math.max(1, Math.ceil(total / filters.pageSize));
  const start = total ? (filters.page - 1) * filters.pageSize + 1 : 0;
  const end = Math.min(filters.page * filters.pageSize, total);
  const activeFilters = activeFilterCount(filters);
  const allVisibleSelected = jobs.length > 0 && jobs.every((job) => selectedIds.includes(job.id));
  const toggleJob = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const toggleVisible = () => setSelectedIds((current) => {
    const visible = jobs.map((job) => job.id);
    if (visible.every((id) => current.includes(id))) return current.filter((id) => !visible.includes(id));
    return [...new Set([...current, ...visible])];
  });

  return (
    <section className="table-panel">
      <div className="table-toolbar">
        <strong>{formatNumber(total)} vagas</strong>
        <span className="table-context">Ordenadas para priorizar aplicações com melhor aderência</span>
        <div className="spacer" />
        <span>Ordenar por:</span>
        <select value={filters.sort} onChange={(event) => setFilters({ sort: event.target.value })}>
          <option value="posted_desc">Mais recentes</option>
          <option value="match_desc">Maior match</option>
          <option value="salary_desc">Maior salário</option>
          <option value="company_asc">Empresa</option>
          <option value="source_asc">Fonte</option>
          <option value="seniority_asc">Nível</option>
        </select>
        {selectedIds.length > 0 && <button className="outline-button compact-action" onClick={() => onExport('excel', 'selected')}>{selectedIds.length} selecionadas</button>}
        <button className="filter-button" onClick={onToggleSidebar} aria-label="Alternar filtros">
          <Filter size={16} />
          Filtros
          {activeFilters > 0 && <b>{activeFilters}</b>}
        </button>
        <button className="icon-button" onClick={onToggleDetail} aria-label="Alternar detalhes"><BriefcaseBusiness size={17} /></button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th><button className={`row-check header-check ${allVisibleSelected ? 'on' : ''}`} onClick={toggleVisible} aria-label="Selecionar vagas visíveis">{allVisibleSelected && <Check size={12} />}</button></th>
              <th>Título</th>
              <th>Empresa</th>
              <th>Fonte</th>
              <th>Localização</th>
              <th>Modelo</th>
              <th>Match</th>
              <th>Nível</th>
              <th>Salário</th>
              <th>Tecnologias</th>
              <th>Publicado em</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan="12" className="loading-row"><Loader2 className="spin" size={18} /> Carregando vagas...</td>
              </tr>
            )}
            {!loading && !jobs.length && (
              <tr>
                <td colSpan="12" className="loading-row">Nenhuma vaga encontrada para os filtros atuais.</td>
              </tr>
            )}
            {!loading && jobs.map((job) => (
              <tr
                key={job.id}
                className={selectedJob?.id === job.id ? 'selected' : ''}
                onClick={() => onSelect(job.id)}
              >
                <td>
                  <button
                    className={`row-check ${selectedIds.includes(job.id) ? 'on' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleJob(job.id);
                    }}
                    aria-label={`Selecionar ${job.title}`}
                  >
                    {selectedIds.includes(job.id) && <Check size={12} />}
                  </button>
                </td>
                <td>
                  <button
                    className="job-title-button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(job.id);
                    }}
                  >
                    {job.title}
                  </button>
                </td>
                <td>{job.company || '—'}</td>
                <td><SourceMark source={job.source} /></td>
                <td>{locationModeLabel(job.location_mode, job.location)}</td>
                <td>{workModel(job)}</td>
                <td><span className={`match-badge ${matchLevel(job).key}`}>{matchPercent(job)}% · {matchLevel(job).label}</span></td>
                <td>{seniority(job)}</td>
                <td>{salaryLabel(job)}</td>
                <td><TechStack technologies={job.matched_technologies} limit={2} /></td>
                <td>{dateLabel(job.posted_at)}</td>
                <td>
                  <a className="row-action" href={job.url || '#'} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} aria-label="Abrir vaga">
                    <ExternalLink size={14} />
                  </a>
                  {jobStatuses[job.id] && <span className={`status-dot ${jobStatuses[job.id]}`} title={statusLabel(jobStatuses[job.id])} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>Linhas por página:</span>
        <select value={filters.pageSize} onChange={(event) => setFilters({ pageSize: Number(event.target.value), page: 1 })}><option>10</option><option>25</option><option>50</option><option>100</option></select>
        <span>{`${start}-${end} de ${formatNumber(total)}`}</span>
        <div className="pager-buttons">
          <button disabled={filters.page <= 1} onClick={() => setFilters({ page: Math.max(1, filters.page - 1) })}><ChevronLeft size={16} /></button>
          <button className="page-active">{filters.page}</button>
          {totalPages > filters.page && <button onClick={() => setFilters({ page: Math.min(totalPages, filters.page + 1) })}>{filters.page + 1}</button>}
          {totalPages > filters.page + 1 && <span>...</span>}
          {totalPages > filters.page + 1 && <button onClick={() => setFilters({ page: totalPages })}>{totalPages}</button>}
          <button disabled={filters.page >= totalPages} onClick={() => setFilters({ page: Math.min(totalPages, filters.page + 1) })}><ChevronRight size={16} /></button>
        </div>
      </div>
    </section>
  );
}

function InsightsView({ insights, jobs, snapshot }) {
  const rankedJobs = jobs.slice().sort((a, b) => matchPercent(b) - matchPercent(a));
  const salary = insights?.salary ?? {};

  return (
    <section className="insights-panel improved">
      <div className="insight-summary">
        <article>
          <span>Base filtrada</span>
          <strong>{formatNumber(insights?.total_jobs ?? 0)}</strong>
          <small>{formatNumber(insights?.strong_matches ?? 0)} vagas com match forte</small>
        </article>
        <article>
          <span>Salário médio</span>
          <strong>{salary.avg ? `${currency('BRL')} ${formatNumber(salary.avg)}` : 'Sem dados'}</strong>
          <small>{percentLabel(insights?.with_salary, insights?.total_jobs)} com faixa salarial</small>
        </article>
        <article>
          <span>Fontes</span>
          <strong>{formatNumber(insights?.sources_active ?? 0)}</strong>
          <small>{formatNumber(insights?.remote_brazil_jobs ?? 0)} remotas Brasil</small>
        </article>
      </div>

      <div className="insight-grid-wide">
        <InsightCard title="Tipo de vaga" items={insights?.by_role ?? []} empty="Sem cargos mapeados" />
        <InsightCard title="Senioridade" items={insights?.by_seniority ?? []} empty="Sem senioridade mapeada" />
        <InsightCard title="Tecnologias mais frequentes" items={insights?.by_technology ?? []} empty="Sem tecnologias no filtro atual" />
        <InsightCard title="Faixas salariais" items={insights?.salary_distribution ?? []} empty="Sem salários mapeados" />
      </div>

      <div className="insight-table priority">
        <h3>Fila de prioridade</h3>
        <p>Ordenada pelo match com as tecnologias do curriculo; use para decidir onde aplicar primeiro.</p>
        {rankedJobs.slice(0, 10).map((job) => (
          <div className="insight-job priority-row" key={job.id}>
            <span>{job.title}</span>
            <small>{job.company || 'Empresa não informada'} - {sourceLabel(job.source)} - {salaryLabel(job)}</small>
            <strong>{matchPercent(job)}%</strong>
          </div>
        ))}
        {!rankedJobs.length && <div className="empty-chart">Sem vagas para gerar ranking.</div>}
      </div>
    </section>
  );
}

function InsightCard({ title, items, empty }) {
  return (
    <article className="insight-card">
      <h3>{title}</h3>
      {items.length ? items.slice(0, 8).map((item) => (
        <div className="insight-row" key={item.name}>
          <span>{item.name}</span>
          <strong>{formatNumber(item.count)}</strong>
        </div>
      )) : <div className="empty-chart">{empty}</div>}
    </article>
  );
}

function DetailPanel({ job, status, onStatus, onClose }) {
  if (!job) {
    return (
      <aside className="detail-panel">
        <button className="close-button" aria-label="Fechar detalhes" onClick={onClose}><X size={22} /></button>
        <div className="empty-detail">Selecione uma vaga para ver os detalhes.</div>
      </aside>
    );
  }

  return (
    <aside className="detail-panel">
      <button className="close-button" aria-label="Fechar detalhes" onClick={onClose}><X size={22} /></button>
      <div className="detail-heading">
        <div>
          <h1>{job.title}</h1>
          <p>{job.company || 'Empresa não informada'}</p>
        </div>
        <div className="company-wordmark">{companyMark(job.company).slice(0, 4).toUpperCase()}</div>
      </div>

      <div className="source-id">
        <SourceMark source={job.source} />
        <span>ID: {job.id?.slice(0, 8)}</span>
      </div>

      <div className="detail-divider" />
      <DetailRow icon={<MapPin size={17} />} label="Localização" value={locationModeLabel(job.location_mode, job.location)} />
      <DetailRow icon={<BriefcaseBusiness size={17} />} label="Modelo" value={job.location_mode === 'remote_brazil' ? 'Remoto' : 'Presencial/Híbrido'} />
      <DetailRow icon={<Filter size={17} />} label="Nível" value={seniority(job)} />
      <DetailRow icon={<CalendarDays size={17} />} label="Publicado em" value={dateLabel(job.posted_at)} />
      <DetailRow icon={<Clock3 size={17} />} label="Coletado em" value={dateTimeLabel(job.collected_at)} />
      <DetailRow icon={<Link2 size={17} />} label="Link da vaga" value={<a href={job.url} target="_blank" rel="noreferrer">{shortUrl(job.url)} <ExternalLink size={13} /></a>} />

      <a className="open-job" href={job.url || '#'} target="_blank" rel="noreferrer">
        Abrir vaga <ExternalLink size={16} />
      </a>

      <div className="detail-actions">
        <button onClick={() => copyJobLink(job.url)}><Copy size={15} /> Copiar link</button>
        <button className={status === 'salva' ? 'active' : ''} onClick={() => onStatus(job.id, 'salva')}><Bookmark size={15} /> Salvar</button>
        <button className={status === 'aplicada' ? 'active' : ''} onClick={() => onStatus(job.id, 'aplicada')}><CheckCircle2 size={15} /> Aplicada</button>
        <button className={status === 'ocultada' ? 'active danger' : 'danger'} onClick={() => onStatus(job.id, 'ocultada')}><EyeOff size={15} /> Ocultar</button>
      </div>

      <section className="detail-section">
        <div className="section-line">
          <span>Match</span>
          <strong>{matchPercent(job)}%</strong>
        </div>
      </section>

      <section className="detail-section">
        <h2>Palavras-chave correspondentes</h2>
        <div className="keyword-list">
          {job.profile_matched_technologies?.length ? (
            job.profile_matched_technologies.map((tech) => <span key={tech}>{tech}</span>)
          ) : (
            <em className="empty-inline">Nenhuma tecnologia mapeada</em>
          )}
        </div>
      </section>

      <DetailRow icon={<Database size={17} />} label="Faixa salarial" value={salaryLabel(job)} trailing={job.salary_currency || 'BRL'} />
      <DetailRow icon={<CalendarDays size={17} />} label="Tipo de contrato" value={job.tags?.[0] || 'CLT'} />

      <section className="detail-section">
        <h2>Descrição</h2>
        <p className="description">
          {job.description || 'Vaga coletada automaticamente pelo DataScrap. Use o link original para revisar requisitos completos, aplicar filtros de match e acompanhar novas oportunidades em dados.'}
        </p>
        <DataWarnings job={job} />
      </section>
    </aside>
  );
}

function DataWarnings({ job }) {
  const warnings = [
    !job.description ? 'Descrição não disponível' : null,
    !(job.salary_min || job.salary_max) ? 'Salário não informado' : null,
    !job.matched_technologies?.length ? 'Tecnologias não detectadas' : null,
    !job.url ? 'Link externo ausente' : null,
  ].filter(Boolean);
  if (!warnings.length) return null;
  return (
    <div className="data-warnings">
      {warnings.map((warning) => <span key={warning}>{warning}</span>)}
    </div>
  );
}

function DetailRow({ icon, label, value, trailing }) {
  return (
    <div className="detail-row">
      <span className="detail-icon">{icon}</span>
      <strong>{label}</strong>
      <span className="detail-value">{value || '—'}</span>
      {trailing && <em>{trailing}</em>}
    </div>
  );
}

function SourceMark({ source }) {
  const label = sourceLabel(source);
  const initial = label.slice(0, 1).toLowerCase();
  return (
    <span className="source-mark">
      <b>{initial}</b>
      {label}
    </span>
  );
}

function TechStack({ technologies = [], limit = 3 }) {
  const visible = technologies.slice(0, limit);
  if (!visible.length) return <span className="empty-inline">—</span>;
  return (
    <span className="tech-stack">
      {visible.map((tech) => <span key={tech}>{tech}</span>)}
      {technologies.length > limit && <em>+{technologies.length - limit}</em>}
    </span>
  );
}

function sourceLabel(source = '') {
  const names = {
    linkedin: 'LinkedIn',
    indeed: 'Indeed',
    jobicy: 'Jobicy',
    gupy: 'Gupy',
    catho: 'Catho',
    remotive: 'Remotive',
    remoteok: 'RemoteOK',
    themuse: 'The Muse'
  };
  return names[source.toLowerCase()] ?? source;
}

function sourceHomepage(source = '') {
  const urls = {
    linkedin: 'https://www.linkedin.com/jobs/',
    indeed: 'https://br.indeed.com/',
    jobicy: 'https://jobicy.com/',
    gupy: 'https://portal.gupy.io/',
    catho: 'https://www.catho.com.br/vagas/',
    remotive: 'https://remotive.com/remote-jobs',
    remoteok: 'https://remoteok.com/',
    themuse: 'https://www.themuse.com/search/jobs',
  };
  return urls[source.toLowerCase()] ?? 'https://www.google.com/search?q=vagas';
}

function normalizeKey(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function locationModeLabel(mode, fallback = '') {
  if (mode === 'remote_brazil') return 'Remoto Brasil';
  if (mode === 'brasilia') return 'Brasília';
  if (mode === 'all') return 'Todas';
  return fallback || 'Outras';
}

function workModel(job) {
  if (job?.location_mode === 'remote_brazil') return 'Remoto';
  if (job?.location_mode === 'brasilia') return 'Híbrido/Presencial';
  return 'Não informado';
}

function matchLevel(job) {
  const score = matchPercent(job);
  if (score >= 85) return { key: 'strong', label: 'Forte' };
  if (score >= 70) return { key: 'good', label: 'Bom' };
  if (score >= 40) return { key: 'medium', label: 'Médio' };
  return { key: 'low', label: 'Baixo' };
}

function statusLabel(status) {
  const labels = {
    salva: 'Vaga salva',
    aplicada: 'Aplicada',
    ocultada: 'Ocultada',
  };
  return labels[status] ?? status;
}

function scrapeStatusLabel(status) {
  const labels = {
    idle: 'Aguardando',
    starting: 'Iniciando',
    running: 'Em execução',
    completed: 'Concluída',
    error: 'Falha',
  };
  return labels[status] || 'Aguardando';
}

function copyJobLink(url) {
  if (!url || typeof navigator === 'undefined') return;
  navigator.clipboard?.writeText(url);
}

function salaryLabel(job) {
  if (job?.salary_min && job?.salary_max) {
    return `${currency(job.salary_currency)} ${formatNumber(job.salary_min)} - ${formatNumber(job.salary_max)}`;
  }
  if (job?.salary_min) return `${currency(job.salary_currency)} ${formatNumber(job.salary_min)}+`;
  return '—';
}

function currency(value) {
  if (value === 'BRL') return 'R$';
  if (value === 'USD') return 'US$';
  return value || 'R$';
}

function seniority(job) {
  if (job?.seniority) return seniorityLabel(job.seniority);
  const text = `${job?.title ?? ''} ${job?.tags?.join(' ') ?? ''}`.toLowerCase();
  if (text.includes('junior') || text.includes('júnior') || text.includes('jr')) return 'Júnior';
  if (text.includes('senior') || text.includes('sênior')) return 'Sênior';
  if (text.includes('estágio') || text.includes('intern')) return 'Estágio';
  return 'Pleno';
}

function seniorityLabel(value = '') {
  const labels = {
    Estagio: 'Estagio',
    Junior: 'Junior',
    Pleno: 'Pleno',
    Senior: 'Senior',
    Especialista: 'Especialista',
    'Nao informado': 'Nao informado'
  };
  return labels[value] ?? value;
}

function matchPercent(job) {
  const score = job?.match_score ?? job?.matched_technologies?.length ?? 0;
  return Math.min(100, Math.max(0, Math.round(score)));
}

function buildTechnologySeniorityMatrix(jobs = []) {
  const seniorities = ['Júnior', 'Pleno', 'Sênior', 'Especialista'];
  const techCounts = new Map();
  const matrix = new Map();

  jobs.forEach((job) => {
    const jobSeniority = seniorities.includes(seniority(job)) ? seniority(job) : 'Pleno';
    (job.matched_technologies ?? []).forEach((tech) => {
      techCounts.set(tech, (techCounts.get(tech) ?? 0) + 1);
      const key = `${tech}|${jobSeniority}`;
      matrix.set(key, (matrix.get(key) ?? 0) + 1);
    });
  });

  const technologies = [...techCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([tech]) => tech);

  return {
    technologies,
    seniorities,
    rows: technologies.map((tech) => ({
      tech,
      values: seniorities.map((item) => matrix.get(`${tech}|${item}`) ?? 0),
    })),
  };
}

function dateLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return date.toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

function dateTimeLabel(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' });
}

function latestCollectionLabel(days = []) {
  const latest = days?.[days.length - 1]?.date;
  return latest ? dateLabel(latest) : '—';
}

function countMap(items = []) {
  return new Map(items.map((item) => [item.name, item.count]));
}

function activeFilterCount(filters) {
  return [
    filters.query,
    filters.source !== 'all',
    filters.locationMode !== 'remote_brazil',
    filters.tech !== 'all',
    filters.salaryOnly,
    filters.descriptionOnly,
    filters.remoteOnly,
    filters.strongMatch,
    filters.salaryRange !== 'all',
    filters.seniority !== 'all',
    filters.city,
    filters.period !== '30',
  ].filter(Boolean).length;
}

function formatNumber(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR').format(number);
}

function formatCompact(value) {
  const number = Number(value ?? 0);
  return new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 }).format(number);
}

function percentLabel(part, total) {
  const denominator = Number(total ?? 0);
  if (!denominator) return '0%';
  return `${Math.round((Number(part ?? 0) / denominator) * 100)}%`;
}

function shortUrl(url = '') {
  if (!url) return '—';
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname.slice(0, 18)}...`;
  } catch {
    return url.slice(0, 28);
  }
}

function companyMark(company = '') {
  const clean = company.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return clean ? clean.slice(0, 9) : 'data';
}

function salaryRangeParams(value) {
  if (value === '0-8000') return { max_salary: '8000' };
  if (value === '8000-15000') return { min_salary: '8000', max_salary: '15000' };
  if (value === '15000+') return { min_salary: '15000' };
  return {};
}

function periodRangeLabel(value) {
  if (value === 'all') return 'Todo o histórico';
  return `Últimos ${value} dias`;
}

function exportRows(jobs, filters) {
  const exportedAt = new Date().toLocaleString('pt-BR');
  const filterSummary = summarizeFilters(filters);
  const headers = ['título', 'empresa', 'fonte', 'localização', 'modelo', 'senioridade', 'match', 'classificação', 'salário', 'publicado_em', 'tecnologias', 'descrição', 'url', 'exportado_em', 'filtros'];
  const rows = jobs.map((job) => [
    job.title,
    job.company,
    sourceLabel(job.source),
    locationModeLabel(job.location_mode, job.location),
    workModel(job),
    seniority(job),
    `${matchPercent(job)}%`,
    matchLevel(job).label,
    salaryLabel(job),
    dateLabel(job.posted_at),
    job.matched_technologies?.join(', ') ?? '',
    job.description ?? '',
    job.url,
    exportedAt,
    filterSummary,
  ]);
  return { headers, rows };
}

function downloadJobsExcel(jobs, filters) {
  const { headers, rows } = exportRows(jobs, filters);
  const table = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="UTF-8" /></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </body>
    </html>
  `;
  const blob = new Blob([table], { type: 'application/vnd.ms-excel;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vagas-datascrap-${new Date().toISOString().slice(0, 10)}.xls`;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadJobsCsv(jobs, filters) {
  const { headers, rows } = exportRows(jobs, filters);
  const csv = [headers, ...rows]
    .map((row) => row.map((value) => `"${String(value ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `vagas-datascrap-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function summarizeFilters(filters) {
  return [
    filters.query ? `busca=${filters.query}` : null,
    filters.source !== 'all' ? `fonte=${filters.source}` : null,
    filters.locationMode !== 'remote_brazil' ? `local=${filters.locationMode}` : null,
    filters.tech !== 'all' ? `tech=${filters.tech}` : null,
    filters.salaryOnly ? 'com_salario' : null,
    filters.descriptionOnly ? 'com_descricao' : null,
    filters.remoteOnly ? 'remotas' : null,
    filters.strongMatch ? 'match_forte' : null,
    filters.period !== '30' ? `periodo=${filters.period}` : null,
  ].filter(Boolean).join('; ') || 'filtros padrão';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

