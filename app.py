from flask import Flask, request, render_template, jsonify, send_file
import pandas as pd
import os
from werkzeug.utils import secure_filename
import json
from datetime import datetime
import tempfile
import urllib.parse

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# 确保上传文件夹存在
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

def get_conversation_type(session_data, session_id):
    """
    计算对话类型
    1: 已保存-无变更
    2: 已保存-有变更  
    3: 未保存-无变更
    4: 未保存-有变更
    """
    global saved_sessions
    
    # 检查是否有变更
    has_changes = False
    for _, row in session_data.iterrows():
        if row['话术内容'] != row['变更后的内容']:
            has_changes = True
            break
    
    # 检查是否已保存
    is_saved = session_id in saved_sessions
    
    if is_saved and not has_changes:
        return 1  # 已保存-无变更
    elif is_saved and has_changes:
        return 2  # 已保存-有变更
    elif not is_saved and not has_changes:
        return 3  # 未保存-无变更
    else:
        return 4  # 未保存-有变更

def get_conversation_statistics():
    """获取对话统计信息"""
    global current_data, session_list, saved_sessions
    
    if current_data is None:
        return {
            'saved_no_change': 0, 
            'saved_has_change': 0, 
            'unsaved_no_change': 0, 
            'unsaved_has_change': 0
        }
    
    stats = {
        'saved_no_change': 0,    # 已保存-无变更
        'saved_has_change': 0,   # 已保存-有变更
        'unsaved_no_change': 0,  # 未保存-无变更
        'unsaved_has_change': 0  # 未保存-有变更
    }
    
    for session_id in session_list:
        session_data = current_data[current_data['sessionId'] == session_id]
        conv_type = get_conversation_type(session_data, session_id)
        
        if conv_type == 1:
            stats['saved_no_change'] += 1
        elif conv_type == 2:
            stats['saved_has_change'] += 1
        elif conv_type == 3:
            stats['unsaved_no_change'] += 1
        elif conv_type == 4:
            stats['unsaved_has_change'] += 1
    
    return stats

# 全局变量存储数据
current_data = None
current_session = 0
total_sessions = 0
session_list = []
saved_sessions = set()  # 存储已保存的会话ID

@app.route('/')
def index():
    return render_template('index.html')

def process_excel_file(filepath):
    """处理Excel文件的公共逻辑"""
    global current_data, current_session, total_sessions, session_list, saved_sessions
    
    try:
        # 读取Excel文件
        df = pd.read_excel(filepath)
        
        # 验证必需的列
        required_columns = ['sessionId', '角色', '话术内容', '变更后的内容', '更新情况', 'LLM完整输出', '更新结果检查', '更新结果检查详情']
        missing_columns = [col for col in required_columns if col not in df.columns]
        
        if missing_columns:
            return {'error': f'缺少必需的列: {", ".join(missing_columns)}'}
        
        # 补充变更后的内容（非空不变，空的使用话术内容填充）
        df['变更后的内容'] = df['变更后的内容'].fillna(df['话术内容'])
        df.loc[df['变更后的内容'] == '', '变更后的内容'] = df.loc[df['变更后的内容'] == '', '话术内容']
        
        # 添加人工校验修正后的内容列
        df['人工校验修正后的内容'] = df['变更后的内容'].copy()
        
        current_data = df
        
        # 获取所有unique的sessionId
        session_list = df['sessionId'].unique().tolist()
        total_sessions = len(session_list)
        current_session = 0
        saved_sessions = set()  # 重置已保存会话
        
        return {
            'success': True,
            'total_sessions': total_sessions,
            'message': f'文件加载成功，共有 {total_sessions} 通对话'
        }
        
    except Exception as e:
        return {'error': f'文件处理错误: {str(e)}'}

@app.route('/upload', methods=['POST'])
def upload_file():
    if 'file' not in request.files:
        return jsonify({'error': '没有选择文件'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': '没有选择文件'}), 400
    
    if file and file.filename.endswith(('.xlsx', '.xls')):
        # 保存上传的文件
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        
        # 处理Excel文件
        result = process_excel_file(filepath)
        if 'error' in result:
            return jsonify(result), 400 if '缺少必需的列' in result['error'] else 500
        
        return jsonify(result)
    
    return jsonify({'error': '请上传Excel文件(.xlsx或.xls)'}), 400

@app.route('/load_path', methods=['POST'])
def load_file_from_path():
    data = request.get_json()
    if not data or 'file_path' not in data:
        return jsonify({'error': '缺少文件路径参数'}), 400
    
    file_path = data['file_path'].strip()
    if not file_path:
        return jsonify({'error': '文件路径不能为空'}), 400
    
    # 检查文件是否存在
    if not os.path.exists(file_path):
        return jsonify({'error': f'文件不存在: {file_path}'}), 400
    
    # 检查文件扩展名
    if not file_path.lower().endswith(('.xlsx', '.xls')):
        return jsonify({'error': '请选择Excel文件(.xlsx或.xls)'}), 400
    
    # 处理Excel文件
    result = process_excel_file(file_path)
    if 'error' in result:
        return jsonify(result), 400 if '缺少必需的列' in result['error'] else 500
    
    return jsonify(result)

@app.route('/get_session/<int:session_index>')
def get_session(session_index):
    global current_data, session_list, saved_sessions
    
    if current_data is None:
        return jsonify({'error': '请先上传文件'}), 400
    
    if session_index < 0 or session_index >= len(session_list):
        return jsonify({'error': '无效的对话索引'}), 400
    
    session_id = session_list[session_index]
    session_data = current_data[current_data['sessionId'] == session_id].copy()
    
    # 计算对话类型
    conversation_type = get_conversation_type(session_data, session_id)
    
    # 转换为前端需要的格式
    rows = []
    for _, row in session_data.iterrows():
        rows.append({
            'index': int(row.name),
            'role': row['角色'],
            'original_content': row['话术内容'],
            'updated_content': row['变更后的内容'],
            'manually_corrected_content': row['人工校验修正后的内容'],
            'update_status': row['更新情况'] if pd.notna(row['更新情况']) else '',
            'llm_output': row['LLM完整输出'] if pd.notna(row['LLM完整输出']) else '',
            'check_result': row['更新结果检查'] if pd.notna(row['更新结果检查']) else '',
            'check_details': row['更新结果检查详情'] if pd.notna(row['更新结果检查详情']) else ''
        })
    
    return jsonify({
        'session_id': session_id,
        'current_session': session_index + 1,
        'total_sessions': len(session_list),
        'conversation_type': conversation_type,
        'is_saved': session_id in saved_sessions,
        'rows': rows
    })

@app.route('/update_row', methods=['POST'])
def update_row():
    global current_data
    
    if current_data is None:
        return jsonify({'error': '请先上传文件'}), 400
    
    data = request.get_json()
    row_index = data.get('row_index')
    action = data.get('action')  # 'accept', 'reject', 'manual'
    manual_content = data.get('manual_content', '')
    
    try:
        if action == 'accept':
            # 采纳：使用变更后的内容
            current_data.loc[row_index, '人工校验修正后的内容'] = current_data.loc[row_index, '变更后的内容']
        elif action == 'reject':
            # 拒绝：使用原始内容
            current_data.loc[row_index, '人工校验修正后的内容'] = current_data.loc[row_index, '话术内容']
        elif action == 'manual':
            # 手动修改
            current_data.loc[row_index, '人工校验修正后的内容'] = manual_content
        
        return jsonify({'success': True})
        
    except Exception as e:
        return jsonify({'error': f'更新失败: {str(e)}'}), 500

@app.route('/export')
def export_excel():
    global current_data
    
    if current_data is None:
        return jsonify({'error': '没有数据可导出'}), 400
    
    try:
        # 创建临时文件
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx')
        
        # 导出Excel
        current_data.to_excel(temp_file.name, index=False)
        
        filename = f'话术示例库更新校验结果_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        
        response = send_file(
            temp_file.name,
            as_attachment=True,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
        
        # 设置正确的Content-Disposition头，使用URL编码
        encoded_filename = urllib.parse.quote(filename.encode('utf-8'))
        response.headers['Content-Disposition'] = f'attachment; filename*=UTF-8\'\'{encoded_filename}'
        
        return response
        
    except Exception as e:
        return jsonify({'error': f'导出失败: {str(e)}'}), 500

@app.route('/save_session', methods=['POST'])
def save_session():
    global saved_sessions
    
    data = request.get_json()
    session_id = data.get('session_id')
    
    if session_id is None:
        return jsonify({'error': '缺少session_id参数'}), 400
    
    try:
        saved_sessions.add(session_id)
        return jsonify({'success': True, 'message': '对话已保存'})
    except Exception as e:
        return jsonify({'error': f'保存失败: {str(e)}'}), 500

@app.route('/get_statistics')
def get_statistics():
    stats = get_conversation_statistics()
    return jsonify(stats)

@app.route('/get_progress')
def get_progress():
    global current_session, total_sessions
    stats = get_conversation_statistics()
    return jsonify({
        'current_session': current_session + 1,
        'total_sessions': total_sessions,
        'statistics': stats
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
