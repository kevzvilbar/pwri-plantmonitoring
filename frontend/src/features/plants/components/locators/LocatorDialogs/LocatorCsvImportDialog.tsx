import { supabase } from '@/integrations/supabase/client';
import { CsvImportDialog } from '@/components/import';

export const LOCATOR_CSV_HEADERS = [
  'name', 'address',
  'meter_brand', 'meter_size', 'meter_serial', 'meter_installed_date',
  'gps_lat', 'gps_lng',
];

export function LocatorCsvImportDialog({ plantId, onClose }: { plantId: string; onClose: () => void }) {
  return (
    <CsvImportDialog
      title="Import Locators from CSV"
      module="locators"
      plantId={plantId}
      templateFilename="locators_template.csv"
      columns={LOCATOR_CSV_HEADERS}
      templateRow={{
        name: 'Locator 1',
        address: 'Main Street',
        meter_brand: 'BrandX',
        meter_size: '2 inch',
        meter_serial: 'SN-12345',
        meter_installed_date: '2024-01-01',
        gps_lat: '10.3157',
        gps_lng: '123.8854',
      }}
      schemaHint={LOCATOR_CSV_HEADERS.join(', ')}
      helpText={<span><strong>name</strong> is required. All others optional.</span>}
      showPreviewTable
      validateRow={(r, i) => (!r.name?.trim() ? [`Row ${i}: name is required`] : [])}
      insertRows={async (rows, pId) => {
        const payload = rows.map((r) => ({
          plant_id: pId,
          name: r.name.trim(),
          address: r.address || null,
          location_desc: r.address || null,
          meter_brand: r.meter_brand || null,
          meter_size: r.meter_size || null,
          meter_serial: r.meter_serial || null,
          meter_installed_date: r.meter_installed_date || null,
          gps_lat: r.gps_lat ? +r.gps_lat : null,
          gps_lng: r.gps_lng ? +r.gps_lng : null,
        }));
        const { error } = await supabase.from('locators').insert(payload);
        if (error) {
          return { count: 0, errors: [error.message] };
        }
        return { count: rows.length, errors: [] };
      }}
      onClose={onClose}
      onImported={onClose}
    />
  );
}
