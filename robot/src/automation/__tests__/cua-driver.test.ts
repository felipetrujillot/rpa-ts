import { describe, expect, it, vi } from 'vitest';
import { CuaDriver, parseCuaResult } from '../drivers/cua-driver';
import { cuaApp } from '../apps/cua.app';
import { AutomationRegistry } from '../core/registry';
const fixture = (elements: unknown[]) => ({ snapshot_id:'s00000001', elements, images:[{data:'image',mimeType:'image/png'}] });
describe('CUA driver', () => {
  it.each(['calculator', 'Calculator.app', '/System/Applications/Calculator.app', 'com.apple.calculator'])('launches %s using the appropriate application selector', async (application) => {
    const call = vi.fn(async () => ({ pid: 10 }));
    const registry = new AutomationRegistry();
    registry.registerApp(cuaApp);
    const result = await registry.execute('cua.app.launch', { application }, { appContexts: { cua: new CuaDriver('test', call) } });
    expect(result.ok).toBe(true);
    const selector = process.platform === 'darwin' && application === 'com.apple.calculator'
      ? { bundle_id: application } : { name: application };
    expect(call).toHaveBeenCalledWith('launch_app', { ...selector, session: 'test', urls: undefined });
  });
  it('extracts structured state and image content and refuses tool errors', () => {
    expect(parseCuaResult(JSON.stringify({ structuredContent:{value:42},content:[{type:'image',data:'png',mimeType:'image/png'}] }))).toMatchObject({value:42,images:[{data:'png'}]});
    expect(() => parseCuaResult(JSON.stringify({isError:true,content:[{type:'text',text:'stale token'}]}))).toThrow('stale token');
  });
  it('captures a fresh exact window before every element click and preserves delivery mode', async () => {
    const call = vi.fn(async () => fixture([{element_token:'s00000001:1',label:'6',role:'AXButton'}]));
    const registry = new AutomationRegistry(); registry.registerApp(cuaApp); const driver = new CuaDriver('test',call);
    const result = await registry.execute('cua.element.click',{pid:10,windowId:20,label:'6',deliveryMode:'background'},{appContexts:{cua:driver}});
    expect(result.ok).toBe(true); expect(call.mock.calls[0]).toMatchObject(['get_window_state',{pid:10,window_id:20}]);
    expect(call.mock.calls[1]).toMatchObject(['click',{pid:10,window_id:20,element_token:'s00000001:1',delivery_mode:'background'}]);
  });
  it('refuses ambiguous controls and requires both a matching value and a screenshot', async () => {
    let state = fixture([{element_token:'a',label:'42'},{element_token:'b',label:'42'}]);
    const call = vi.fn(async () => state); const registry = new AutomationRegistry(); registry.registerApp(cuaApp); const ctx={appContexts:{cua:new CuaDriver('test',call)}};
    expect((await registry.execute('cua.element.click',{pid:10,windowId:20,label:'42'},ctx)).ok).toBe(false);
    expect(call).toHaveBeenCalledTimes(1);
    state = fixture([{element_token:'a',role:'AXStaticText',value:'42'}]);
    expect((await registry.execute('cua.window.assert',{pid:10,windowId:20,expected:'42',role:'AXStaticText'},ctx)).ok).toBe(true);
    state.images=[];
    expect((await registry.execute('cua.window.assert',{pid:10,windowId:20,expected:'42'},ctx)).ok).toBe(false);
  });
  it('waits for an admitted native action to finish during cancellation', async () => {
    let finish!: (value: Record<string,unknown>) => void;
    const call = vi.fn((tool: string) => tool === 'click' ? new Promise<Record<string,unknown>>((resolve) => {finish=resolve;}) : Promise.resolve({}));
    const driver = new CuaDriver('test',call); const action=driver.call('click',{}); const stopping=driver.shutdown();
    await expect(driver.call('list_apps')).rejects.toThrow('STOPPED'); expect(call).toHaveBeenCalledTimes(1);
    finish({}); await action; await stopping; expect(call).toHaveBeenLastCalledWith('end_session',{session:'test'});
  });
});
