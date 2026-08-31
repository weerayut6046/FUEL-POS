import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';
import type { LiveState } from '../useLive.js';

interface Props {
  live: LiveState;
  subscribeTraffic: (busId: string | null) => void;
  onToast: (level: 'info' | 'warn' | 'error', message: string) => void;
}

type Tool = 'monitor' | 'discover' | 'decode';

/**
 * เครื่องมือถอดรหัสโปรโตคอลของตู้จ่าย
 *
 * ใช้เมื่อไม่มีเอกสารโปรโตคอลจากผู้ผลิต (กรณีบอร์ด ZB01-1 / RT-TG224)
 * ขั้นตอนแนะนำอยู่ในหน้าจอ และมีรายละเอียดเต็มที่ docs/02-protocol-discovery.md
 */
export function ProtocolLab({ live, subscribeTraffic, onToast }: Props) {
  const [tool, setTool] = useState<Tool>('monitor');
  const [buses, setBuses] = useState<Awaited<ReturnType<typeof api.lab.buses>>>([]);
  const [profiles, setProfiles] = useState<Awaited<ReturnType<typeof api.lab.profiles>>>([]);
  const [ports, setPorts] = useState<Awaited<ReturnType<typeof api.lab.serialPorts>>>([]);
  const [selectedBus, setSelectedBus] = useState('');
  const [hexToSend, setHexToSend] = useState('02 01 11 01 13 03');
  const [decodeProfile, setDecodeProfile] = useState('');
  const [decodeHex, setDecodeHex] = useState('');
  const [decodeResult, setDecodeResult] = useState<unknown>(null);
  const [portPath, setPortPath] = useState('');
  const [baudResults, setBaudResults] = useState<Awaited<ReturnType<typeof api.lab.scanBaud>>>([]);
  const [sniffResult, setSniffResult] = useState<Awaited<ReturnType<typeof api.lab.sniff>> | null>(null);
  const [probeResult, setProbeResult] = useState<Awaited<ReturnType<typeof api.lab.probeAddresses>> | null>(null);
  const [analysis, setAnalysis] = useState<Awaited<ReturnType<typeof api.lab.analyze>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.lab.buses().then((list) => {
      setBuses(list);
      if (list[0]) setSelectedBus(list[0].id);
    }).catch(() => undefined);
    api.lab.profiles().then((list) => {
      setProfiles(list);
      if (list[0]) setDecodeProfile(list[0].id);
    }).catch(() => undefined);
    api.lab.serialPorts().then((list) => {
      setPorts(list);
      if (list[0]) setPortPath(list[0].path);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedBus) return;
    subscribeTraffic(selectedBus);
    return () => subscribeTraffic(null);
  }, [selectedBus, subscribeTraffic]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [live.traffic.length]);

  const capturedFrames = useMemo(
    () => live.traffic.filter((t) => t.direction === 'rx').map((t) => t.hex),
    [live.traffic],
  );

  const run = async (key: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      onToast('error', (err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="stack">
      <div className="panel">
        <h3>เครื่องมือถอดรหัสโปรโตคอลตู้จ่าย</h3>
        <div className="hint">
          บอร์ด <b>ZB01-1</b> ในตู้ RT-TG224 ไม่มีเอกสารโปรโตคอลสาธารณะ หน้านี้จึงมีไว้หาโปรโตคอลจริงจากหน้างาน
          เมื่อถอดรหัสได้แล้วให้แก้ไฟล์ profile (JSON) โดยไม่ต้องแก้โปรแกรม
          <br />
          <b>ลำดับที่แนะนำ:</b> ① หาความเร็ว (baud) → ② ดักฟังข้อมูล → ③ วิเคราะห์หา checksum และตำแหน่งข้อมูล
          → ④ ทดลองส่งคำสั่ง → ⑤ เขียนลง profile
        </div>
      </div>

      <div className="row">
        {(
          [
            ['monitor', 'เฝ้าดูบัส'],
            ['discover', 'ค้นหาโปรโตคอล'],
            ['decode', 'ถอดรหัส / ทดสอบคำสั่ง'],
          ] as [Tool, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tool === key ? 'primary' : ''}
            onClick={() => setTool(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tool === 'monitor' && (
        <div className="panel">
          <h3>ข้อมูลดิบบนบัส</h3>
          <div className="row" style={{ marginBottom: 10 }}>
            <select value={selectedBus} onChange={(e) => setSelectedBus(e.target.value)} style={{ maxWidth: 320 }}>
              {buses.map((bus) => (
                <option key={bus.id} value={bus.id}>
                  {bus.label} — {bus.describe} {bus.connected ? '(เชื่อมต่อแล้ว)' : '(ไม่ได้เชื่อมต่อ)'}
                </option>
              ))}
            </select>
            <span className={`badge ${live.connected ? 'ok' : 'danger'}`}>
              {live.connected ? 'รับข้อมูลสด' : 'ขาดการเชื่อมต่อ'}
            </span>
            <span className="hint">{live.traffic.length} บรรทัด</span>
          </div>

          <div className="traffic-log mono" ref={logRef}>
            {live.traffic.map((entry, i) => (
              <div key={i} className={entry.direction}>
                {new Date(entry.at).toLocaleTimeString('th-TH')}{' '}
                {entry.direction === 'tx' ? '→ ส่ง' : '← รับ'} {entry.hex}
              </div>
            ))}
            {live.traffic.length === 0 && (
              <div className="hint">ยังไม่มีข้อมูล — ระบบจะแสดงทุกไบต์ที่วิ่งบนบัสที่เลือก</div>
            )}
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              disabled={busy !== null || capturedFrames.length === 0}
              onClick={() =>
                void run('analyze', async () => {
                  setAnalysis(await api.lab.analyze(capturedFrames.slice(-100)));
                  setTool('discover');
                })
              }
            >
              วิเคราะห์เฟรมที่รับมา ({capturedFrames.length})
            </button>
          </div>
        </div>
      )}

      {tool === 'discover' && (
        <div className="stack">
          <div className="panel">
            <h3>① หาความเร็วสื่อสาร (baud rate)</h3>
            <div className="hint" style={{ marginBottom: 10 }}>
              ต้องมีอุปกรณ์อื่นคุยกับตู้อยู่ หรือตู้ส่งข้อมูลออกมาเองจึงจะได้ผล
              ถ้าบัสเงียบสนิท ให้ข้ามไปขั้นตอนทดลองส่งคำสั่งแทน
            </div>
            <div className="row" style={{ marginBottom: 10 }}>
              <select value={portPath} onChange={(e) => setPortPath(e.target.value)} style={{ maxWidth: 320 }}>
                {ports.map((port) => (
                  <option key={port.path} value={port.path}>
                    {port.path} {port.manufacturer ? `— ${port.manufacturer}` : ''}
                  </option>
                ))}
                {ports.length === 0 && <option value="">ไม่พบพอร์ตอนุกรมในเครื่อง</option>}
              </select>
              <button
                type="button"
                disabled={!portPath || busy !== null}
                onClick={() => void run('baud', async () => setBaudResults(await api.lab.scanBaud(portPath)))}
              >
                {busy === 'baud' ? 'กำลังสแกน… (ราว 25 วินาที)' : 'สแกนความเร็ว'}
              </button>
            </div>

            {baudResults.length > 0 && (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="num">baud</th>
                      <th className="num">ไบต์</th>
                      <th className="num">บล็อก</th>
                      <th className="num">คะแนน</th>
                      <th>ตัวอย่างข้อมูล</th>
                    </tr>
                  </thead>
                  <tbody>
                    {baudResults.map((row) => (
                      <tr key={row.baudRate}>
                        <td className="num">{row.baudRate}</td>
                        <td className="num">{row.bytes}</td>
                        <td className="num">{row.blocks}</td>
                        <td className="num">{row.score}</td>
                        <td className="mono">{row.sample}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="panel">
            <h3>② ดักฟังข้อมูลบนสาย</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                disabled={!portPath || busy !== null}
                onClick={() =>
                  void run('sniff', async () => setSniffResult(await api.lab.sniff(portPath, 9600, 8000)))
                }
              >
                {busy === 'sniff' ? 'กำลังดักฟัง 8 วินาที…' : 'ดักฟัง 8 วินาที ที่ 9600'}
              </button>
              <button
                type="button"
                disabled={!selectedBus || busy !== null}
                onClick={() =>
                  void run('probe', async () => setProbeResult(await api.lab.probeAddresses(selectedBus, 0, 16)))
                }
              >
                {busy === 'probe' ? 'กำลังค้นหา…' : 'ค้นหา address ของตู้ (0–16)'}
              </button>
            </div>

            {sniffResult && (
              <div className="stack">
                <div className="hint">
                  ได้ {sniffResult.totalBytes} ไบต์ / {sniffResult.blocks.length} บล็อก
                  {sniffResult.suggestion.boundaries && (
                    <>
                      {' '}· คาดว่า STX = 0x
                      {sniffResult.suggestion.boundaries.stx.toString(16).padStart(2, '0')}, ETX = 0x
                      {sniffResult.suggestion.boundaries.etx.toString(16).padStart(2, '0')}
                    </>
                  )}
                </div>
                <pre className="traffic-log mono" style={{ margin: 0 }}>
                  {sniffResult.summary.join('\n')}
                </pre>
                <div className="traffic-log mono">
                  {sniffResult.blocks.slice(0, 60).map((block, i) => (
                    <div key={i} className="rx">
                      [{String(block.length).padStart(3)}] {block.hex}   {block.ascii}
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    void run('analyze2', async () =>
                      setAnalysis(await api.lab.analyze(sniffResult.blocks.map((b) => b.hex))),
                    )
                  }
                >
                  วิเคราะห์เฟรมเหล่านี้
                </button>
              </div>
            )}

            {probeResult && (
              <div style={{ marginTop: 10 }}>
                {probeResult.found.length > 0 ? (
                  <div className="panel">
                    พบตู้ที่ address:{' '}
                    {probeResult.found.map((f) => (
                      <span key={f.address} className="badge ok" style={{ marginRight: 6 }}>
                        {f.address}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="warn-box">
                    ไม่พบตู้ที่ตอบกลับ — อาจเป็นเพราะโปรไฟล์ยังไม่ถูกต้อง, สาย A/B สลับกัน,
                    ความเร็วไม่ตรง หรือ address อยู่นอกช่วงที่ค้นหา
                  </div>
                )}
              </div>
            )}
          </div>

          {analysis && (
            <div className="panel">
              <h3>③ ผลวิเคราะห์เฟรม</h3>
              <pre className="traffic-log mono" style={{ margin: '0 0 10px' }}>
                {analysis.summary.join('\n')}
              </pre>
              {analysis.checksums.length > 0 && (
                <>
                  <h4>สูตร checksum ที่เป็นไปได้</h4>
                  <ul className="hint">
                    {analysis.checksums.map((c, i) => (
                      <li key={i}>{c.description}</li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {tool === 'decode' && (
        <div className="stack">
          <div className="panel">
            <h3>ทดลองส่งคำสั่งดิบเข้าบัส</h3>
            <div className="warn-box" style={{ marginBottom: 10 }}>
              ระวัง: คำสั่งที่ส่งไปถึงตู้จ่ายจริง อาจทำให้ตู้เริ่มจ่ายน้ำมันได้
              ควรทดลองตอนที่ไม่มีลูกค้าและปิดวาล์วหรือถอดหัวจ่ายไว้ก่อน
            </div>
            <div className="row">
              <select value={selectedBus} onChange={(e) => setSelectedBus(e.target.value)} style={{ maxWidth: 260 }}>
                {buses.map((bus) => (
                  <option key={bus.id} value={bus.id}>
                    {bus.label}
                  </option>
                ))}
              </select>
              <input
                className="mono"
                value={hexToSend}
                onChange={(e) => setHexToSend(e.target.value)}
                placeholder="เช่น 02 01 11 01 13 03"
                style={{ maxWidth: 380 }}
              />
              <button
                type="button"
                disabled={!selectedBus || busy !== null}
                onClick={() =>
                  void run('send', async () => {
                    const result = await api.lab.send(selectedBus, hexToSend);
                    onToast('info', `ส่งแล้ว: ${result.sent} — ดูคำตอบที่แท็บ “เฝ้าดูบัส”`);
                  })
                }
              >
                ส่ง
              </button>
            </div>
          </div>

          <div className="panel">
            <h3>ถอดรหัสเฟรมด้วยโปรไฟล์</h3>
            <div className="row" style={{ marginBottom: 10 }}>
              <select value={decodeProfile} onChange={(e) => setDecodeProfile(e.target.value)} style={{ maxWidth: 260 }}>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <input
                className="mono"
                value={decodeHex}
                onChange={(e) => setDecodeHex(e.target.value)}
                placeholder="วางไบต์ที่ดักจับได้ที่นี่"
                style={{ maxWidth: 420 }}
              />
              <button
                type="button"
                disabled={!decodeProfile || !decodeHex || busy !== null}
                onClick={() =>
                  void run('decode', async () =>
                    setDecodeResult(await api.lab.decode(decodeProfile, decodeHex)),
                  )
                }
              >
                ถอดรหัส
              </button>
            </div>
            {decodeResult !== null && (
              <pre className="traffic-log mono" style={{ margin: 0 }}>
                {JSON.stringify(decodeResult, null, 2)}
              </pre>
            )}
          </div>

          <div className="panel">
            <h3>โปรไฟล์ที่มีในระบบ</h3>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>รหัส</th>
                    <th>ชื่อ</th>
                    <th className="num">baud</th>
                    <th>การตัดเฟรม</th>
                    <th>checksum</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
                  {profiles.map((profile) => (
                    <tr key={profile.id}>
                      <td className="mono">{profile.id}</td>
                      <td>{profile.name}</td>
                      <td className="num">{profile.baudRate}</td>
                      <td>{profile.framing}</td>
                      <td>{profile.checksum}</td>
                      <td>
                        {profile.unverified ? (
                          <span className="badge warn">ยังไม่ยืนยันกับตู้จริง</span>
                        ) : (
                          <span className="badge ok">ยืนยันแล้ว</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>
              แก้ไขโปรไฟล์ได้ที่ไฟล์ JSON ในโฟลเดอร์ <span className="mono">data/profiles</span>{' '}
              แล้วรีสตาร์ตโปรแกรม — ไฟล์ในโฟลเดอร์นี้จะถูกใช้แทนโปรไฟล์ที่มากับโปรแกรมที่มี id เดียวกัน
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
