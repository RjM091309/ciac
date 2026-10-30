import React, { useEffect, useMemo, useState } from 'react';
import { FileCheck2 } from 'lucide-react';
import { toast } from 'sonner';
import { useControlPanelAccess } from '../../context/ControlPanelAccessContext';
import { AppSelect } from '../ui/AppSelect';
import { DataTableControls } from '../ui/DataTableControls';
import { EmptyState } from '../ui/EmptyState';
import { TableSkeleton } from '../ui/Skeleton';
import { Chip, ExportButtons, fmtDate, logReportExport, ReportTile, SearchBox, useReport } from './reportParts';
import { downloadPdf, downloadWorkbook, xlDate } from './reportExports';
import { usePagination } from './reportUtils';

type Filing = 'CURRENT' | 'OVERDUE' | 'NONE';
type DocStatus = 'VALID' | 'EXPIRED' | 'PENDING' | 'REJECTED';
type Row = {
  proponent_id: number;
  ref_no: string | null;
  business_name: string;
  account_officer: string | null;
  gis_date: string | null;
  filing_status: Filing;
  document: { id: number; file_name: string | null; valid_until: string | null; uploaded_at: string | null; status: DocStatus } | null;
};
type Data = { as_of: string; rows: Row[] };

const FILING: Record<Filing, { label: string; tone: string }> = {
  CURRENT: { label: 'Filed (last 12 months)', tone: 'var(--tone-green)' },
  OVERDUE: { label: 'Over 12 months ago', tone: 'var(--tone-amber)' },
  NONE: { label: 'No filing recorded', tone: 'var(--tone-red)' },
};
const DOC: Record<DocStatus | 'NONE', { label: string; tone: string }> = {
  VALID: { label: 'Valid', tone: 'var(--tone-green)' },
  PENDING: { label: 'Waiting for review', tone: 'var(--tone-blue)' },
  EXPIRED: { label: 'Expired', tone: 'var(--tone-amber)' },
  REJECTED: { label: 'Rejected', tone: 'var(--tone-red)' },
  NONE: { label: 'No document', tone: 'var(--tone-gray)' },
};
const docKey = (r: Row) => r.document?.status || 'NONE';
const TITLE = 'GENERAL INFORMATION SHEET (GIS) FILING OF LOCATORS';

/** G-09 GIS output: each registered locator's Latest GIS Filing (SEC
 * Registration Information) and its latest GIS compliance document. */
export function GisFilingReport({ navigate }: { navigate?: (to: string, opts?: { replace?: boolean }) => void }) {
  const { data, initialLoading, error } = useReport<Data>('/api/reports/gis');
  const [search, setSearch] = useState('');
  const [filing, setFiling] = useState('');
  const [doc, setDoc] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [exporting, setExporting] = useState<'xlsx' | 'pdf' | null>(null);
  const { fullAccess, sidebarPermissions } = useControlPanelAccess();
  const canOpenLocator = Boolean(navigate) && (fullAccess || Boolean(sidebarPermissions['settings:proponents']));

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.rows || []).filter(
      (r) =>
        (!filing || r.filing_status === filing) &&
        (!doc || docKey(r) === doc) &&
        (!q || [r.business_name, r.ref_no, r.account_officer].some((v) => String(v || '').toLowerCase().includes(q)))
    );
  }, [data, search, filing, doc]);
  useEffect(() => setPage(1), [search, filing, doc]);
  const pg = usePagination(rows, pageSize, page);

  const count = (f: (r: Row) => boolean) => (data?.rows || []).filter(f).length;
  const filters = { search: search.trim() || undefined, status: [filing, doc].filter(Boolean).join(' / ') || undefined };
  const note = 'A filing counts as current for 12 months after the Latest GIS Filing date (the GIS is filed every year).';

  const columns = ['Ref No.', 'Locator', 'Latest GIS Filing', 'Filing', 'GIS Document', 'Document Status', 'Valid Until', 'Account Officer'];

  async function exportExcel() {
    if (!data) return;
    setExporting('xlsx');
    try {
      await downloadWorkbook(`ciac-gis-filing-${data.as_of}.xlsx`, TITLE, [
        {
          name: 'GIS Filing',
          subtitle: `AS OF ${fmtDate(data.as_of).toUpperCase()}`,
          columns: columns.map((h) => ({
            header: h.toUpperCase(),
            width: h === 'Locator' ? 40 : h === 'GIS Document' ? 36 : h === 'Account Officer' ? 24 : 20,
            align: h === 'Locator' || h === 'GIS Document' ? 'left' : 'center',
            bold: h === 'Locator',
            numFmt: h === 'Latest GIS Filing' || h === 'Valid Until' ? 'd mmmm yyyy' : undefined,
          })),
          groups: rows.map((r) => ({
            lines: [
              [
                r.ref_no,
                r.business_name,
                xlDate(r.gis_date),
                FILING[r.filing_status].label,
                r.document?.file_name ?? null,
                DOC[docKey(r)].label,
                xlDate(r.document?.valid_until),
                r.account_officer,
              ],
            ],
          })),
          notes: [note],
          empty: 'None.',
        },
      ]);
      logReportExport('gis', 'xlsx', rows.length, filters);
      toast.success('Report exported to Excel');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to export');
    } finally {
      setExporting(null);
    }
  }

  async function exportPdf() {
    if (!data) return;
    setExporting('pdf');
    try {
      await downloadPdf(`ciac-gis-filing-${data.as_of}.pdf`, TITLE, `As of ${fmtDate(data.as_of)}`, [
        {
          columns,
          aligns: columns.map((h) => (h === 'Locator' || h === 'GIS Document' ? 'left' : 'center')),
          body: rows.map((r) => [
            r.ref_no || '',
            r.business_name,
            r.gis_date ? fmtDate(r.gis_date) : '',
            FILING[r.filing_status].label,
            r.document?.file_name || '',
            DOC[docKey(r)].label,
            r.document?.valid_until ? fmtDate(r.document.valid_until) : '',
            r.account_officer || '',
          ]),
          notes: [note],
          empty: 'None.',
        },
      ]);
      logReportExport('gis', 'pdf', rows.length, filters);
      toast.success('Report exported to PDF');
    } catch (e) {
      toast.error((e as Error).message || 'Failed to export');
    } finally {
      setExporting(null);
    }
  }

  const tile = (key: Filing) => (
    <ReportTile
      key={key}
      label={FILING[key].label}
      value={count((r) => r.filing_status === key)}
      tone={key === 'CURRENT' ? undefined : FILING[key].tone}
      loading={initialLoading}
      active={filing === key}
      onClick={() => setFiling((cur) => (cur === key ? '' : key))}
      sub={filing === key ? 'Filtering · click to clear' : 'Filter the list'}
    />
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        <ReportTile label="Registered locators" value={data?.rows.length ?? 0} loading={initialLoading} sub={data ? `As of ${fmtDate(data.as_of)}` : undefined} />
        {(['CURRENT', 'OVERDUE', 'NONE'] as Filing[]).map(tile)}
      </div>

      <div className="glass-card p-3 sm:p-5 !border-transparent overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
        <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 mb-3">
          <SearchBox value={search} onChange={setSearch} placeholder="Search locator / ref no. / officer…" />
          <div className="w-full sm:w-48">
            <AppSelect
              compact
              isClearable
              placeholder="Any filing"
              value={filing}
              onChange={(v) => setFiling(v || '')}
              options={(Object.keys(FILING) as Filing[]).map((k) => ({ value: k, label: FILING[k].label }))}
            />
          </div>
          <div className="w-full sm:w-48">
            <AppSelect
              compact
              isClearable
              placeholder="Any document"
              value={doc}
              onChange={(v) => setDoc(v || '')}
              options={(Object.keys(DOC) as (DocStatus | 'NONE')[]).map((k) => ({ value: k, label: DOC[k].label }))}
            />
          </div>
          <ExportButtons disabled={!data || !rows.length} exporting={exporting} onExcel={exportExcel} onPdf={exportPdf} />
        </div>
        <p className="text-[11px] text-secondary mb-3">
          Latest GIS Filing from each locator's SEC Registration Information, and the latest GIS uploaded on its Compliance page. {note}
        </p>

        {error && !data ? (
          <EmptyState icon={<FileCheck2 size={40} className="opacity-40" />} title="Couldn't load the report" description={error} />
        ) : initialLoading ? (
          <TableSkeleton rows={6} />
        ) : !rows.length ? (
          <EmptyState icon={<FileCheck2 size={40} className="opacity-40" />} title="No locators" description="Try adjusting your search or filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Ref No.', 'Locator', 'Latest GIS Filing', 'GIS Document', 'Valid Until', 'Account Officer'].map((h) => (
                    <th key={h} className="px-3 py-2.5 text-[10px] uppercase tracking-wider text-secondary whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pg.pageItems.map((r) => (
                  <tr key={r.proponent_id} style={{ borderTop: '1px solid var(--border-subtle)' }}>
                    <td className="px-3 py-2 text-[11px] text-secondary whitespace-nowrap font-mono">{r.ref_no || '—'}</td>
                    <td className="px-3 py-2 text-[11px] font-semibold min-w-[200px]">
                      {canOpenLocator ? (
                        <button type="button" className="text-left hover:underline" style={{ color: 'var(--text)' }} onClick={() => navigate?.(`/applications/proponents?proponentId=${r.proponent_id}`)}>
                          {r.business_name}
                        </button>
                      ) : (
                        <span style={{ color: 'var(--text)' }}>{r.business_name}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] whitespace-nowrap">
                      <div className="flex flex-col items-start gap-1.5">
                        <span>{fmtDate(r.gis_date)}</span>
                        <Chip tone={FILING[r.filing_status].tone}>{FILING[r.filing_status].label}</Chip>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] max-w-[260px]">
                      <div className="flex flex-col items-start gap-1.5 min-w-0">
                        <span className="block max-w-full truncate" title={r.document?.file_name || undefined}>
                          {r.document?.file_name || <span className="text-secondary">—</span>}
                        </span>
                        <Chip tone={DOC[docKey(r)].tone}>{DOC[docKey(r)].label}</Chip>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap">{fmtDate(r.document?.valid_until)}</td>
                    <td className="px-3 py-2 text-[11px] whitespace-nowrap text-secondary">{r.account_officer || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <DataTableControls
          page={page}
          totalPages={pg.totalPages}
          totalItems={rows.length}
          showingFrom={pg.showingFrom}
          showingTo={pg.showingTo}
          visiblePageNumbers={pg.visiblePageNumbers}
          pageSize={pageSize}
          pageSizeOptions={[10, 25, 50, 100]}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
          onPageChange={setPage}
          loading={initialLoading}
        />
      </div>
    </div>
  );
}
