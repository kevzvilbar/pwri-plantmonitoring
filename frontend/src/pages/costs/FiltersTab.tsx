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

export function FiltersTab() {
  const { isManager, isAdmin } = useAuth();
  const { selectedPlantId } = useAppStore();
  const { data: plants } = usePlants();
  const [plantId, setPlantId] = useState(selectedPlantId ?? '');

  const plant = plants?.find((p) => p.id === plantId);
  const canEdit = usePermission('costs', 'edit');

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <Label htmlFor="costs-plant-1" className="text-xs">Plant</Label>
        <PlantPicker value={plantId} onChange={setPlantId} id="costs-plant-1" />
      </Card>
      {!plantId && <Card className="p-6 text-center text-sm text-muted-foreground">Select a plant</Card>}
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
