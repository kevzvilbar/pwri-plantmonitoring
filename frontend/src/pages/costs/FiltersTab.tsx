import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePermission } from '@/hooks/usePermission';
import { useAppStore } from '@/store/appStore';
import { usePlants } from '@/hooks/usePlants';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { PlantPicker } from '@/components/costs/PlantPicker';
import { CostsFiltersTab } from '@/components/costs/CostsFiltersTab';

import { Building2 } from 'lucide-react';

export function FiltersTab() {
  const { isManager, isAdmin } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  const plant = plants?.find((p) => p.id === plantId);
  const canEdit = usePermission('costs', 'edit');

  return (
    <div className="space-y-3">
      {/* ── Toolbar ── */}
      <div className="p-1.5 rounded-xl border border-border/50 bg-card flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-sm">
          <div className="flex-1">
            <PlantPicker value={plantId} onChange={setPlantId} id="costs-plant-1" />
          </div>
        </div>
        {plant && (
          <div className="flex items-center gap-2 text-2xs text-muted-foreground px-2">
            <span className="font-medium text-foreground">{plant.filter_housing_type}</span>
          </div>
        )}
      </div>

      {!plantId && (
        <Card className="p-8 text-center space-y-1 rounded-xl border border-dashed shadow-none">
          <p className="text-xs font-semibold text-foreground">Select a plant</p>
          <p className="text-3xs text-muted-foreground">Choose a facility from the picker above to load filter replacement history and costs.</p>
        </Card>
      )}

      {plantId && plant && (
        <CostsFiltersTab
          plantId={plantId}
          plantName={plant.name}
          filterHousingType={plant.filter_housing_type}
          canEdit={canEdit}
        />
      )}
    </div>
  );
}
