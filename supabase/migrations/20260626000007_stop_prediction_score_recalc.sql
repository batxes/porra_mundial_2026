-- Score totals only need to be recalculated when official results/events
-- change. Prediction autosaves can be frequent, and the old trigger forced a
-- full score_entries rebuild on every insert/update/delete in predictions.
drop trigger if exists recalculate_scores_after_prediction_change on public.predictions;
