import axios from "axios";
import ProgressBar from 'progress';
import { existsSync, mkdirSync, createWriteStream, renameSync } from 'fs';
import { join } from "path";
import inquirer from "inquirer";
import chalk from 'chalk';

let server = process.env.SERVER

let needLogin = false;
let phone = ''
let allArtist: { artistName: string, artistId: number }[] = []
let offset = 0;
let limit = 50;
let downCount = 0;
let downedSongs: string[] = []
let isShowAllCount = false
let songer = '';
let songerId = 0;
let directory = ''
let delay = 2

const bar = new ProgressBar('总进度: [:bar] :current/:total :percent, 当前正在下载: :name', {
  complete: '=',
  incomplete: ' ',
  width: 20,
  total: 0
});

//#region 打印信息
const log = (...info: any[]) => {
  console.log(...info);
}

const infoMsg = (...info: any[]) => {
  return chalk.white(...info);
}

const susMsg = (...info: any[]) => {
  return chalk.green(...info);
}

const importentMsg = (...info: any[]) => {
  return chalk.bold.cyan.bgBlue(...info);
}

const errMsg = (...info: any[]) => {
  return chalk.red(...info);
}

const warnMsg = (...info: any[]) => {
  return chalk.yellow(...info);
}
//#endregion

//#region 通用函数
/**
 * 请求数据
 * @param url 接口地址
 * @param params 参数
 */
const getData = async (url: string, params?: Record<string, string | number>) => {
  try {
    const res = await axios({
      url: server + url,
      params
    });
    return res.data;
  } catch (error) {
    log(errMsg(`请求失败: ${error}`));
    return null;
  }
}

/**
 * 获取用户输入
 * @param opt 参数
 */
const getInput = async (opt: Record<string, any>) => {
  try {
    const data = await inquirer.prompt(opt);
    return data;
  } catch (error) {
    log(errMsg(`输入失败: ${error}`));
    return null;
  }
}
//#endregion

//#region 接口调用
const getIsLogin = async (cookie: string) => {
  const res = await getData('/login/status')
  if (res && res.data && res.data.profile) {
    log(susMsg("Cookie有效, 用户: "), importentMsg(res.data.profile.nickname));
    return true
  }
  log(errMsg("Cookie无效"));
  return false
}

const getCaptcha = async (phone: string) => {
  const res = await getData('/captcha/sent', {
    phone
  })
  if (res && res.code === 200) {
    log(susMsg('验证码发送成功'));
    return true
  } else {
    log(errMsg(res.message ? '验证码发送失败, ' + res.message : '验证码发送失败'));
    return false
  }
}

const getLogin = async (captcha: string) => {
  let res = await getData('/login/cellphone', {
    phone,
    captcha
  })
  if (res && res.code === 200) {
    log(importentMsg(res.profile.nickname), susMsg(' 登录成功'));
    const cookieString: string = res.cookie;
    const needCookie = ['MUSIC_U', '__remember_me', '__csrf']
    const cookieArr = cookieString.split(';')
      .filter(item => item.includes('='))
      .filter(item => needCookie.some(key => item.includes(key)))
      .map(item => item.trim());
    axios.defaults.headers.common['Cookie'] = cookieArr.join('; ');
    log(susMsg('Cookie可以拷贝保留下来, 下次直接使用: '));
    log(chalk.blue(axios.defaults.headers.common['Cookie']));
    return true
  } else {
    log(errMsg('验证码错误'));
    return false
  }
}

const getSongerkeyword = async (keyword: string) => {
  const res = await getData('/ugc/artist/search', {
    keyword
  })
  if (!res || res.code !== 200) {
    log(errMsg('获取歌手失败'));
    return false
  }
  if (res.data.list.length === 0) {
    log(errMsg('无结果，请重新输入'));
    return false
  }
  allArtist = res.data.list
  return true
}
//#endregion

//#region 获取基本配置
const getServerIpInput = async () => {
  const data = await getInput([
    {
      type: 'input',
      name: 'ip',
      message: '请输入后台服务IP地址和端口, 如无直接回车使用默认地址:',
      validate: (val: string) => {
        if (!val || val.trim() === '') {
          return true
        } else {
          if (val.match(/^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?):(?:[0-9]{1,5})$/)) {
            return true
          } else {
            return '请输入正确的IP地址和端口'
          }
        }
      }
    }
  ]);
  if (data?.ip) {
    log(`使用配置的服务地址: ${susMsg(data.ip)}`)
    server = `http://${data.ip}`
  } else {
    log(susMsg('使用默认在线服务地址'))
    server = `http://${server}`
  }
}

const getDelayInput = async () => {
  const data = await getInput([
    {
      type: 'number',
      name: 'delay',
      message: '请输入下载延迟时间(单位: 秒)防止被反爬虫检测到, 如无直接回车使用默认时间:',
      default: delay,
      validate: (val: string) => {
        val = val ? val.toString() : ''
        if (!val || val.trim() === '') {
          return true
        } else {
          if (val.match(/^[0-9]+$/)) {
            return true
          } else {
            return '请输入正确的延迟时间'
          }
        }
      }
    }
  ]);
  if (data?.delay) {
    log(`使用延迟时间: ${susMsg(data.delay)} 秒`)
    delay = data.delay
  } else {
    log(`使用延迟时间: ${susMsg(delay)} 秒`)
  }
}

const getBasicSet = async () => {
  await getServerIpInput()
  await getDelayInput()
}
//#endregion

//#region 获取登录信息
const getCookieInput = async () => {
  const data = await getInput([
    {
      type: 'input',
      name: 'cookie',
      message: '有 Cookie 请输入, 否则直接回车进行登录:',
    }
  ]);
  if (!data?.cookie) {
    needLogin = true
    return
  }
  axios.defaults.headers.common['Cookie'] = data.cookie;
  const ok = await getIsLogin(data.cookie)
  if (!ok) {
    await getCookieInput()
  }
}

const getPhoneInput = async () => {
  const data = await getInput([
    {
      type: 'number',
      name: 'phone',
      message: '请输入手机号:',
      validate: (val: string) => {
        val = val ? val.toString() : ''
        if (!val || val.trim() === '') {
          return '请输入手机号'
        } else {
          if (val.match(/^1[3-9]\d{9}$/)) {
            return true
          } else {
            return '请输入正确的手机号'
          }
        }
      }
    }
  ]);
  if (data?.phone) {
    phone = data.phone
    const ok = await getCaptcha(phone)
    if (!ok) {
      await getPhoneInput()
    }
  } else {
    await getPhoneInput()
  }
}

const getVerifyCodeInput = async () => {
  const data = await getInput([
    {
      type: 'number',
      name: 'verifyCode',
      message: '请输入验证码:',
      validate: (val: string) => {
        val = val ? val.toString() : ''
        if (!val || val.trim() === '') {
          return '请输入验证码'
        } else {
          if (val.match(/^\d+$/)) {
            return true
          }
          return '请输入验证码'
        }
      }
    }
  ]);
  if (data?.verifyCode) {
    const ok = await getLogin(data.verifyCode)
    if (!ok) {
      await getVerifyCodeInput()
    }
  } else {
    await getVerifyCodeInput()
  }
}

const toLogin = async () => {
  await getCookieInput()
  if (needLogin) {
    await getPhoneInput()
    await getVerifyCodeInput()
  }
}
//#endregion

//#region 获取歌手信息
const getSongerkeywordInput = async () => {
  const data = await getInput([
    {
      type: 'input',
      name: 'keyword',
      message: '请输入歌手关键词:',
      validate: (val: string) => {
        if (!val || val.trim() === '') {
          return '请输入歌手关键词'
        } else {
          return true
        }
      }
    }
  ]);
  if (data?.keyword) {
    const ok = await getSongerkeyword(data.keyword)
    if (!ok) {
      await getSongerkeywordInput()
    } else {
      await getSongerInput()
    }
  }
}

const getSongerInput = async () => {
  const choices: any[] = allArtist.map(item => ({
    name: item.artistName,
    value: item.artistId
  }))
  choices.push(new inquirer.Separator(), {
    name: '重新搜索歌手',
    value: 'cxsr'
  })
  const opt = {
    type: "list",
    message: "请选择歌手:",
    name: "id",
    choices
  }
  const data = await getInput(opt);
  if (!data?.id) {
    await getSongerInput()
    return
  }
  if (data.id === 'cxsr') {
    await getSongerkeywordInput()
    return
  }
  const artist = allArtist.find(item => item.artistId === data.id)
  if (!artist || !artist.artistId) {
    await getSongerInput()
    return
  }
  songer = artist.artistName
  songerId = artist.artistId
  log(`开始下载 ${importentMsg(songer)} 的歌曲`);
  directory = join(process.cwd(), songer)
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

const getSongerInfo = async () => {
  await getSongerkeywordInput()
}
//#endregion

//#region 下载歌曲
const getAllSongs = async () => {
  const res = await getData('/artist/songs', {
    id: songerId,
    order: 'hot',
    limit,
    offset
  })
  if (!res || res.code !== 200) {
    log(errMsg('下载中断，原因: ', (res && res.msg) ? res.msg : '未知'));
    await downFinish(
      errMsg(`需下载 ${importentMsg(bar.total)} 首, 去除重复及无版权歌曲总共下载 ${importentMsg(downedSongs.length)} 首\n下载路径: ${chalk.white(directory)}\n歌曲列表:\n${chalk.cyan.bold(downedSongs.join(', '))}`)
    )
    return
  }
  if (!isShowAllCount) {
    isShowAllCount = true
    bar.total = res.total;
  }
  downSong(res.songs, async () => {
    if (res.more) {
      offset += limit;
      getAllSongs()
    } else {
      await downFinish(
        susMsg(`需下载 ${importentMsg(bar.total)} 首, 去除重复及无版权歌曲总共下载 ${importentMsg(downedSongs.length)} 首\n下载路径: ${chalk.white(directory)}\n歌曲列表:\n${chalk.cyan.bold(downedSongs.join(', '))}`)
      )
    }
  })
}

const isDownloaded = (len: number, call: () => void) => {
  downCount++;
  if (downCount === len) {
    call()
  }
}

const update = (name: string) => {
  bar.tick(1, { name })
}

const downSong = async (songs: { id: number, name: string }[], call: () => void) => {
  downCount = 0
  for (let i = 0; i < songs.length; i++) {
    const element = songs[i];
    const id = element.id;
    let name = element.name;

    name = name.replace(/[\/\\]/g, '+');

    const fileNameNoHz = `${name}-${songer}`;
    const filePath = join(directory, fileNameNoHz);

    downedSongs.push(name)

    if (existsSync(filePath + '.mp3') ||
      existsSync(filePath + '.flac') ||
      existsSync(filePath + '.ape') ||
      existsSync(filePath + '.wav') ||
      existsSync(filePath + '.m4a') ||
      existsSync(filePath + '.ogg') ||
      existsSync(filePath + '.ape')) {
      update(name + ' 已下载')
      isDownloaded(songs.length, call)
      continue;
    }

    // 延迟 1s 防止被封
    await new Promise(resolve => {
      setTimeout(() => {
        resolve(null)
      }, delay * 1000)
    })

    update(name)
    const res = await getData('/song/url/v1', {
      id,
      level: 'jymaster'
    })
    if (!res || res.code !== 200 || !res.data || !res.data[0] || !res.data[0].url) {
      isDownloaded(songs.length, call)
    } else {
      const url = res.data[0].url;
      const type = url.split('.').pop();
      await down(url, filePath + `.${type}`)
      isDownloaded(songs.length, call)
    }
  }
}

const down = async (url: string, filePath: string) => {
  const tmpelPath = filePath + '.tmp'
  const writer = createWriteStream(tmpelPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  });
  response.data.pipe(writer);
  return new Promise((resolve) => {
    writer.on('finish', async () => {
      // 下载完成重命名文件
      renameSync(tmpelPath, filePath);
      resolve(null)
    });
    writer.on('error', resolve);
  });
}

const downFinish = async (msg: string) => {
  log(msg);
  const data = await getInput({
    type: 'list',
    message: '选择下一步操作:',
    name: 'next',
    choices: ['退出', '返回搜索']
  })
  if (!data || data.next === '退出') {
    process.exit(0)
  } else {
    reset()
    main(3)
  }
}
//#endregion

const reset = () => {
  downedSongs = []
  bar.curr = 0
  isShowAllCount = false
}

const main = async (step = 1) => {
  if (step === 1) {
    log('自动下载网易云音乐歌手全部歌曲工具')
    log(`工具依赖 ${chalk.bold.bgGreen('neteasecloudmusicapi')} 后台服务, 可以选择自己部署, 部署请参考: ${chalk.bold.blue.underline('https://gitlab.com/Binaryify/neteasecloudmusicapi')}`)
    log('不想部署，请直接使用默认地址')
    await getBasicSet()
    await toLogin()
    await getSongerInfo()
    await getAllSongs()
  } else if (step === 3) {
    await getSongerInfo()
    await getAllSongs()
  }
}

main()