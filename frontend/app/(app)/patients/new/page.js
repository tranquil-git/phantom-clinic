'use client';

// UC11 Tạo hồ sơ bệnh nhân
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import PatientForm from '@/components/PatientForm';
import { PageHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAction } from '@/lib/hooks';

function NewPatientInner() {
  const router = useRouter();
  const params = useSearchParams();
  const action = useAction();

  async function submit(form) {
    const res = await action.run(() => api('/patients', { method: 'POST', body: form }));
    if (!res) return;
    // Tạo từ màn đặt lịch thì quay lại đặt lịch cho người vừa tạo
    router.push(params.get('next') === 'booking' ? `/appointments/new?patient_id=${res.id}` : `/patients/${res.id}`);
  }

  return (
    <>
      <PageHeader title="Hồ sơ bệnh nhân mới" subtitle="Hồ sơ cũ trên giấy: ghi số hồ sơ giấy để tra khi cần (không số hóa hàng loạt)" />
      <div className="card">
        <PatientForm onSubmit={submit} busy={action.busy} error={action.error} submitLabel="Tạo hồ sơ" />
      </div>
    </>
  );
}

export default function NewPatientPage() {
  return <Suspense><NewPatientInner /></Suspense>;
}
