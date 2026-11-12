export const REPORT_INITIAL = {
  plant_id: '',
  incident_type: '',
  severity: 'Medium' as 'Low' | 'Medium' | 'High' | 'Critical',
  what_description: '',
  where_location: '',
  gps_lat: null as number | null,
  gps_lng: null as number | null,
  when_datetime: '',
  witness: '',
  weather: 'Clear',
  temperature_c: '',
  immediate_action: '',
};
