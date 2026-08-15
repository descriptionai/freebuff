// 차종별 운송용기 적재수량 (이미지 스캔)
// ※ 수집편은 롤팔레트 + 낱소포만 적재 가능 — 평팔레트 컬럼은 수집편 계산에 미사용
// ※ 낱소포 운임 적용 기준(비고): 차량용적이나 용기적재수량 2/3 이상 실었을 때
// ※ 미확인: 롤팔레트 위 빨간 필기 "1.5배" — 의미 사용자 확인 필요
window.LOADING_CAPACITY = {
  label: "차종별 운송용기 적재수량",
  columns: ["차종", "적재정량", "지원단 롤팔레트", "지원단 평팔레트", "사송 롤팔레트", "사송 평팔레트"],
  rows: [
    { vehicle: "소형차", ton: "1.0톤",  direct: { roll: null, flat: null }, carrier: { roll: null, flat: null } },
    { vehicle: "소형차", ton: "2.5톤",  direct: { roll: { min: 2, max: 5 }, flat: { min: 2, max: 3 } }, carrier: { roll: { min: 2, max: 5 }, flat: { min: 2, max: 3 } } },
    { vehicle: "중형차", ton: "4.5톤",  direct: { roll: { min: 6, max: 7 }, flat: { min: 4, max: 5 } }, carrier: { roll: { min: 6, max: 8 }, flat: { min: 4, max: 5 } } },
    { vehicle: "대형차", ton: "5.0톤",  direct: { roll: { min: 8, max: 10 }, flat: { min: 6, max: 7 } }, carrier: { roll: { min: 9, max: 12 }, flat: { min: 6, max: 8 } } },
    { vehicle: "대형차", ton: "8.0톤",  direct: { roll: { min: 11, max: 14 }, flat: { min: 8, max: 10 } }, carrier: { roll: { min: 13, max: 15 }, flat: { min: 9, max: 12 } } },
    { vehicle: "대형차", ton: "11.0톤", direct: { roll: { min: 15, max: 18 }, flat: { min: 11, max: 12 } }, carrier: { roll: { min: 16, max: 19 }, flat: { min: 13, max: 16 } } },
    { vehicle: "대형차", ton: "18.0톤", direct: { roll: { min: 19, max: 20 }, flat: { min: 13, max: 14 } }, carrier: { roll: { min: 20, max: 23 }, flat: { min: 17, max: 20 } } },
    { vehicle: "대형차", ton: "25.0톤", direct: { roll: { min: 21, max: 24 }, flat: { min: 15, max: 16 } }, carrier: { roll: { min: 24, max: null }, flat: { min: 21, max: null } } }
  ],
  remark: "비고(낱소포): 차량용적이나 용기적재수량 2/3 이상 실었을 때",
  annotations: ["롤팔레트 위 빨간 필기 '1.5배' — 의미 미확인 (사용자 확인 필요)"]
};
