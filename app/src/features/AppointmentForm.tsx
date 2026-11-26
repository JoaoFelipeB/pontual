import { useEffect, useRef, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useSession } from '../lib/session';
import { animalLine, maskPhone, relDay } from '../lib/format';
import type { Appointment, Slot, Species, TutorSummary } from '../lib/types';
import { Button, Drawer, Field, Input, Segmented, Select, SpeciesIcon, Textarea, toast, useDebounced } from '../components/ui';

interface Props {
  open: boolean;
  edit?: Appointment;
  preset?: { date?: string; time?: string; tutorId?: string };
  onClose: () => void;
  onSaved: (a: Appointment) => void;
}

const EMPTY = {
  tutor_name: '', tutor_phone: '', animal_name: '', species: 'cao' as Species, breed: '', sex: '',
  age_value: '', age_unit: 'anos', date: '', time: '', vet_id: '', service_type: 'particular', plan: '',
  reason: '', notes: ''
};
type FormState = typeof EMPTY;

export function AppointmentForm({ open, edit, preset, onClose, onSaved }: Props) {
  const { boot } = useSession();
  const [f, setF] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [tutor, setTutor] = useState<TutorSummary | null>(null); // existing tutor picked from search
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => { const n = { ...e }; delete n[k]; return n; });
  };

  // reset whenever the drawer opens
  useEffect(() => {
    if (!open || !boot) return;
    setErrors({});
    setTutor(null);
    if (edit) {
      setF({
        tutor_name: edit.tutor.name, tutor_phone: edit.tutor.phone, animal_name: edit.animal.name,
        species: edit.animal.species, breed: edit.animal.breed ?? '', sex: edit.animal.sex ?? '',
        age_value: edit.animal.age_value?.toString() ?? '', age_unit: edit.animal.age_unit,
        date: edit.date, time: edit.time, vet_id: edit.vet_id ?? '', service_type: edit.service_type,
        plan: edit.plan ?? '', reason: edit.reason ?? '', notes: edit.notes ?? ''
      });
    } else {
      setF({ ...EMPTY, date: preset?.date ?? boot.today, time: preset?.time ?? '' });
      if (preset?.tutorId) api.getTutor(preset.tutorId).then((t) => pickTutor(t)).catch(() => {});
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function pickTutor(t: TutorSummary) {
    setTutor(t);
    setF((x) => ({ ...x, tutor_name: t.name, tutor_phone: t.phone }));
    if (t.animals.length === 1) pickAnimal(t.animals[0]);
  }
  function pickAnimal(a: TutorSummary['animals'][number] | null) {
    setF((x) => a
      ? { ...x, animal_name: a.name, species: a.species, breed: a.breed ?? '', sex: a.sex ?? '', age_value: a.age_value?.toString() ?? '', age_unit: a.age_unit }
      : { ...x, animal_name: '', species: 'cao', breed: '', sex: '', age_value: '', age_unit: 'anos' });
  }

  // plan no longer valid for the species → clear it
  const plans = boot?.plans ?? [];
  useEffect(() => {
    const p = plans.find((x) => x.code === f.plan);
    if (p?.species && p.species !== f.species) set('plan', '');
  }, [f.species]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setSaving(true);
    try {
      const a = await api.saveAppointment(edit?.id ?? null, {
        ...f, age_value: f.age_value === '' ? null : Number(f.age_value),
        plan: f.service_type === 'plano' ? f.plan : null, vet_id: f.vet_id || null
      });
      toast.ok(edit ? 'Alterações salvas.' : `${a.animal.name} agendado: ${relDay(a.date, boot!.today).toLowerCase()} às ${a.time}.`);
      onSaved(a);
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors(e.fields);
        toast.error(e.message);
      }
    } finally {
      setSaving(false);
    }
  }

  if (!boot) return null;
  return (
    <Drawer
      open={open} onClose={onClose} wide
      title={<><h2>{edit ? 'Editar agendamento' : 'Novo agendamento'}</h2>{edit && <small>Nº {edit.number}</small>}</>}
      footer={<>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" onClick={save} loading={saving}>{edit ? 'Salvar alterações' : 'Confirmar agendamento'}</Button>
      </>}
    >
      <form className="form" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <section className="form-section">
          <h3>Paciente</h3>
          {!edit && <TutorSearch onPick={pickTutor} picked={tutor} onClear={() => { setTutor(null); setF((x) => ({ ...x, tutor_name: '', tutor_phone: '' })); pickAnimal(null); }} />}
          {tutor && tutor.animals.length > 0 && (
            <div className="animal-picker" role="radiogroup" aria-label="Animal">
              {tutor.animals.map((a) => (
                <button type="button" key={a.id} role="radio" aria-checked={f.animal_name === a.name}
                  className={`animal-opt ${f.animal_name === a.name ? 'is-active' : ''}`} onClick={() => pickAnimal(a)}>
                  <SpeciesIcon species={a.species} /><span><b>{a.name}</b><small>{animalLine(a)}</small></span>
                </button>
              ))}
              <button type="button" className={`animal-opt animal-new ${!tutor.animals.some((a) => a.name === f.animal_name) ? 'is-active' : ''}`}
                onClick={() => pickAnimal(null)}>
                <span className="species"><UserPlus size={16} /></span><span><b>Outro animal</b><small>Cadastrar novo</small></span>
              </button>
            </div>
          )}
          <div className="grid-2">
            <Field label="Tutor" required error={errors.tutor_name}>
              <Input value={f.tutor_name} onChange={(e) => set('tutor_name', e.target.value)} placeholder="Nome completo" autoComplete="off" />
            </Field>
            <Field label="Telefone (WhatsApp)" required error={errors.tutor_phone}>
              <Input value={f.tutor_phone} onChange={(e) => set('tutor_phone', maskPhone(e.target.value))} inputMode="tel" placeholder="(83) 98888-7777" />
            </Field>
            <Field label="Animal" required error={errors.animal_name}>
              <Input value={f.animal_name} onChange={(e) => set('animal_name', e.target.value)} placeholder="Nome do animal" autoComplete="off" />
            </Field>
            <Field label="Espécie" error={errors.species}>
              <Select value={f.species} onChange={(e) => set('species', e.target.value as Species)}>
                <option value="cao">Cão</option><option value="gato">Gato</option><option value="outro">Outro</option>
              </Select>
            </Field>
            <Field label="Raça" error={errors.breed}>
              <Input value={f.breed} onChange={(e) => set('breed', e.target.value)} placeholder="Opcional" />
            </Field>
            <div className="grid-2 tight">
              <Field label="Sexo" error={errors.sex}>
                <Select value={f.sex} onChange={(e) => set('sex', e.target.value)}>
                  <option value="">—</option><option value="macho">Macho</option><option value="femea">Fêmea</option>
                </Select>
              </Field>
              <Field label="Idade" error={errors.age_value}>
                <div className="input-group">
                  <Input value={f.age_value} onChange={(e) => set('age_value', e.target.value.replace(/\D/g, '').slice(0, 2))} inputMode="numeric" placeholder="—" />
                  <Select value={f.age_unit} onChange={(e) => set('age_unit', e.target.value)} aria-label="Unidade">
                    <option value="anos">anos</option><option value="meses">meses</option>
                  </Select>
                </div>
              </Field>
            </div>
          </div>
        </section>

        <section className="form-section">
          <h3>Data e horário</h3>
          <div className="grid-2">
            <Field label="Data" required error={errors.date}>
              <Input type="date" value={f.date} min={edit ? undefined : boot.today}
                onChange={(e) => { set('date', e.target.value); set('time', ''); }} />
            </Field>
            <Field label="Veterinário" error={errors.vet_id}>
              <Select value={f.vet_id} onChange={(e) => set('vet_id', e.target.value)}>
                <option value="">Sem preferência</option>
                {boot.vets.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            </Field>
          </div>
          <Slots date={f.date} value={f.time} excludeId={edit?.id} keep={edit && edit.date === f.date ? edit.time : null}
            onChange={(t) => set('time', t)} error={errors.time} />
        </section>

        <section className="form-section">
          <h3>Atendimento</h3>
          <Segmented label="Forma de pagamento" value={f.service_type as 'particular' | 'plano'}
            options={[{ value: 'particular', label: 'Particular' }, { value: 'plano', label: 'Plano de saúde' }]}
            onChange={(v) => set('service_type', v)} />
          {f.service_type === 'plano' && (
            <div className="plan-grid" role="radiogroup" aria-label="Plano">
              {plans.map((p) => {
                const blocked = !!p.species && p.species !== f.species;
                return (
                  <button type="button" key={p.code} role="radio" aria-checked={f.plan === p.code} disabled={blocked}
                    className={`plan-opt ${f.plan === p.code ? 'is-active' : ''}`} onClick={() => set('plan', p.code)}>
                    <b>{p.name}</b>
                    <small>{blocked ? `Só para ${p.species === 'cao' ? 'cães' : p.species === 'gato' ? 'gatos' : 'outras espécies'}` : p.description ?? p.code}</small>
                  </button>
                );
              })}
              {errors.plan && <span className="field-error full">{errors.plan}</span>}
            </div>
          )}
          <div className="grid-2">
            <Field label="Motivo da consulta" error={errors.reason}>
              <Input value={f.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Ex.: vacinação anual" />
            </Field>
            <Field label="Observações" error={errors.notes}>
              <Textarea value={f.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="Alergias, medicações, comportamento" />
            </Field>
          </div>
        </section>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}

function TutorSearch({ onPick, picked, onClear }: { onPick: (t: TutorSummary) => void; picked: TutorSummary | null; onClear: () => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [res, setRes] = useState<TutorSummary[]>([]);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (dq.trim().length < 2) { setRes([]); return; }
    let live = true;
    api.searchPatients(dq, 6).then((r) => live && setRes(r)).catch(() => {});
    return () => { live = false; };
  }, [dq]);

  if (picked) {
    return (
      <div className="picked">
        <span>Cliente cadastrado: <b>{picked.name}</b> {picked.phone}</span>
        <button type="button" className="link" onClick={onClear}>Trocar</button>
      </div>
    );
  }
  return (
    <div className="combo">
      <Search size={16} className="combo-icon" />
      <input className="input" value={q} placeholder="Buscar cliente cadastrado por nome, telefone ou animal"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)} aria-label="Buscar cliente" />
      {open && res.length > 0 && (
        <ul className="combo-list" role="listbox">
          {res.map((t) => (
            <li key={t.id}>
              <button type="button" onMouseDown={() => { onPick(t); setQ(''); setOpen(false); }}>
                <b>{t.name}</b><small>{t.phone}{t.animals.length ? ` | ${t.animals.map((a) => a.name).join(', ')}` : ''}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Slot grid. Only the newest request for the date currently selected is drawn. */
function Slots({ date, value, onChange, excludeId, keep, error }: {
  date: string; value: string; onChange: (t: string) => void; excludeId?: string; keep: string | null; error?: string;
}) {
  const [data, setData] = useState<{ date: string; past_day: boolean; slots: Slot[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const req = useRef(0);
  useEffect(() => {
    if (!date) { setData(null); return; }
    const my = ++req.current;
    setLoading(true);
    api.slots(date, excludeId).then((d) => {
      if (my === req.current && d.date === date) setData(d);
    }).catch((e) => toast.error(e.message)).finally(() => my === req.current && setLoading(false));
  }, [date, excludeId]);

  const slots = (data?.slots ?? []).map((s) => (s.time === keep ? { ...s, available: true, reason: null } : s));
  return (
    <div className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">Horário <i aria-hidden="true">*</i></span>
      {loading && !data ? <div className="slots-note">Carregando horários…</div>
        : !date ? <div className="slots-note">Escolha a data.</div>
        : data?.past_day && !keep ? <div className="slots-note">Essa data já passou.</div>
        : !slots.some((s) => s.available) ? <div className="slots-note">Nenhum horário livre nesse dia.</div>
        : (
          <div className={`slots ${loading ? 'is-loading' : ''}`}>
            {slots.map((s) => (
              <button type="button" key={s.time} disabled={!s.available}
                className={`slot ${value === s.time ? 'is-active' : ''} ${s.reason ? `slot-${s.reason}` : ''}`}
                title={s.reason === 'ocupado' ? `Ocupado: ${s.animal_name}` : s.reason === 'passado' ? 'Horário já passou' : undefined}
                onClick={() => onChange(s.time)}>{s.time}</button>
            ))}
          </div>
        )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
