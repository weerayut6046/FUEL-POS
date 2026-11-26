/// ข้อมูลตัวอย่างรูปแบบเดียวกับที่ API ส่งมา
library;

final Map<String, dynamic> setupFixture = {
  'today': '2026-11-26',
  'cashAlertSatang': 10000,
  'branch': {'id': 'b1', 'code': 'HQ', 'name': 'สาขาบ้านนา', 'active': true},
  'fuelTypes': [
    {'id': 'f1', 'code': 'B7', 'name': 'ดีเซล B7', 'color': '#2E7D32', 'sortOrder': 0, 'active': true},
    {'id': 'f2', 'code': 'G95', 'name': 'แก๊สโซฮอล์ 95', 'color': '#EF6C00', 'sortOrder': 1, 'active': true},
  ],
  'tanks': [
    {'id': 't1', 'code': 'T1', 'name': 'ถัง 1', 'fuelTypeId': 'f1', 'capacityLitres': '20000.000', 'reorderLitres': '3000.000'},
  ],
  'nozzles': [
    {'id': 'n1', 'code': '1A', 'name': 'หัว 1A', 'dispenserNo': 1, 'fuelTypeId': 'f1', 'tankId': 't1', 'meterModulus': '1000000.000'},
    {'id': 'n2', 'code': '1B', 'name': 'หัว 1B', 'dispenserNo': 1, 'fuelTypeId': 'f2', 'tankId': 't1', 'meterModulus': '1000000.000'},
  ],
  'prices': [
    {'fuelTypeId': 'f1', 'priceSatang': 3244},
    {'fuelTypeId': 'f2', 'priceSatang': 3785},
  ],
  'staff': [
    {'id': 'u1', 'displayName': 'สมชาย', 'role': 'staff'},
    {'id': 'u2', 'displayName': 'ผู้จัดการ', 'role': 'manager'},
  ],
  'calibrations': {
    't1': {
      'id': 'c1',
      'tankId': 't1',
      'points': [
        {'mm': '0.0', 'litres': '0.000'},
        {'mm': '2000.0', 'litres': '20000.000'},
      ],
    },
  },
  'lastCloseReadings': [
    {'nozzleId': 'n1', 'reading': '1000.000', 'shiftId': 's0', 'businessDate': '2026-11-25', 'shiftNo': 2},
  ],
  'lastShift': {'id': 's0', 'businessDate': '2026-11-25', 'shiftNo': 2, 'status': 'approved'},
  'openShift': null,
};

Map<String, dynamic> _reading(String id, String nozzleId, String kind, String value) => {
      'id': id,
      'nozzleId': nozzleId,
      'kind': kind,
      'reading': value,
      'rollover': false,
      'photoId': null,
      'supersedesId': null,
      'reason': null,
      'recordedBy': 'u1',
      'recordedByName': 'สมชาย',
      'recordedAt': '2026-11-26T01:00:00.000Z',
      'current': true,
    };

final Map<String, dynamic> detailFixture = {
  'shift': {
    'id': 's1',
    'branchId': 'b1',
    'businessDate': '2026-11-26',
    'shiftNo': 1,
    'status': 'open',
    'openedBy': 'u1',
    'openedByName': 'สมชาย',
  },
  'nozzles': [
    {
      'nozzleId': 'n1',
      'code': '1A',
      'name': 'หัว 1A',
      'dispenserNo': 1,
      'fuelTypeId': 'f1',
      'tankId': 't1',
      'priceSatang': 3244,
      'attendantId': 'u1',
      'meterModulus': '1000000.000',
      'open': _reading('srv1', 'n1', 'open', '1000.000'),
      'close': null,
      'test': null,
      'prevClose': '1000.000',
      'nextOpen': null,
    },
    {
      'nozzleId': 'n2',
      'code': '1B',
      'name': 'หัว 1B',
      'dispenserNo': 1,
      'fuelTypeId': 'f2',
      'tankId': 't1',
      'priceSatang': 3785,
      'attendantId': 'u1',
      'meterModulus': '1000000.000',
      'open': _reading('srv3', 'n2', 'open', '2000.000'),
      'close': _reading('srv2', 'n2', 'close', '2010.000'),
      'test': null,
      'prevClose': null,
      'nextOpen': null,
    },
  ],
  'collections': [],
  'history': {'readings': [], 'tests': [], 'collections': []},
  'issues': [],
  'events': [],
};
