// PET / KET 模考套卷目录 (Paper Catalog)
const PAPERS_CATALOG = {
  PET: [
    {
      id: 'test1',
      label: '试卷 1',
      sourceLabel: 'Test1 · 官方样题',
      objCount: 57,
      durationDesc: '约 137 分钟',
      description: '听力 25 题 · 阅读 32 题 · 写作与口语',
      title: 'Preliminary English Test for Schools · Sample'
    },
    {
      id: 'test2',
      label: '试卷 2',
      sourceLabel: 'Test2 · 官方模考',
      objCount: 57,
      durationDesc: '约 137 分钟',
      description: '听力 25 题 · 阅读 32 题 · 写作与口语',
      title: 'Preliminary English Test for Schools · Test 2'
    }
  ],
  KET: [
    {
      id: 'test1',
      label: '试卷 1',
      sourceLabel: 'Test1 · 官方样题',
      objCount: 55,
      durationDesc: '约 102 分钟',
      description: '听力 25 题 · 阅读 30 题 · 读写 P6-7 · 口语',
      title: 'A2 Key for Schools · Sample'
    },
    {
      id: 'test2',
      label: '试卷 2',
      sourceLabel: 'Test2 · 2024第006套',
      objCount: 55,
      durationDesc: '约 102 分钟',
      description: '听力 25 题 · 阅读 30 题 · 读写 P6-7 · 口语',
      title: 'A2 Key for Schools · Test 2 (2024第006套)'
    }
  ]
};

if (typeof window !== "undefined") window.PAPERS_CATALOG = PAPERS_CATALOG;
if (typeof global !== "undefined") global.PAPERS_CATALOG = PAPERS_CATALOG;
